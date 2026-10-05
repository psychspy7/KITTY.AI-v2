package com.kitty.ai.auth

import android.app.Activity
import android.util.Base64
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.withResumed
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import java.security.SecureRandom
import kotlinx.coroutines.tasks.await

class GoogleLogin(private val auth: FirebaseAuth) {
    suspend fun signIn(activity: Activity, clientId: String) {
        val nonce =
            Base64.encodeToString(
                ByteArray(32).also { SecureRandom().nextBytes(it) },
                Base64.NO_WRAP,
            )
        val option = GetSignInWithGoogleOption.Builder(clientId).setNonce(nonce).build()
        val result =
            try {
                CredentialManager.create(activity)
                    .getCredential(
                        activity,
                        GetCredentialRequest.Builder().addCredentialOption(option).build(),
                    )
            } catch (error: NoCredentialException) {
                throw IllegalStateException(
                    "Add a Google account on this device and check Google Play services.",
                    error,
                )
            } catch (error: GetCredentialCancellationException) {
                throw IllegalStateException(
                    "Google did not complete sign-in. Try again, or use browser sign-in below.",
                    error,
                )
            }
        check(result.credential is CustomCredential) {
            "Google returned an unsupported credential. Use browser sign-in."
        }
        val credential = GoogleIdTokenCredential.createFrom(result.credential.data)
        (activity as? LifecycleOwner)?.lifecycle?.withResumed { Unit }
        val user =
            auth
                .signInWithCredential(GoogleAuthProvider.getCredential(credential.idToken, null))
                .await()
                .user
        check(user != null) { "Google sign-in did not create a session. Please try again." }
    }

    suspend fun signOut(activity: Activity) {
        auth.signOut()
        runCatching {
            CredentialManager.create(activity).clearCredentialState(ClearCredentialStateRequest())
        }
    }
}
