import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.gms.google-services")
}

val signing =
    Properties().apply {
        val f = rootProject.file("keystore.properties")
        if (f.exists()) f.inputStream().use { load(it) }
    }
val backendUrl =
    providers.gradleProperty("kittyBackendUrl").orElse("https://kitty-ai-v2.invalid").get()

android {
    namespace = "com.kitty.ai"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.kitty.ai"
        minSdk = 26
        targetSdk = 35
        versionCode = providers.gradleProperty("kittyVersionCode").orElse("1").get().toInt()
        versionName = providers.gradleProperty("kittyVersionName").orElse("1.0.0").get()
        buildConfigField("String", "BACKEND_URL", "\"${backendUrl.replace("\"", "") }\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    signingConfigs {
        create("owner") {
            if (signing.isNotEmpty()) {
                storeFile = file(signing.getProperty("storeFile"))
                storePassword =
                    System.getenv("KITTY_RELEASE_STORE_PASSWORD")
                        ?: signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword =
                    System.getenv("KITTY_RELEASE_KEY_PASSWORD")
                        ?: signing.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (signing.isNotEmpty()) signingConfig = signingConfigs.getByName("owner")
        }
        debug {}
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

tasks.register("verifyReleaseSetup") {
    doLast {
        require(!backendUrl.endsWith(".invalid")) {
            "Set -PkittyBackendUrl=https://your-worker.workers.dev"
        }
        require(signing.isNotEmpty()) {
            "Add local keystore.properties pointing to your preserved owner signing key."
        }
        require(android.signingConfigs.getByName("owner").storePassword?.isNotEmpty() == true) {
            "Use scripts/build-android.ps1 to unlock the local signing password."
        }
    }
}

tasks.matching { it.name == "preReleaseBuild" }.configureEach { dependsOn("verifyReleaseSetup") }

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation(platform("com.google.firebase:firebase-bom:34.18.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("androidx.credentials:credentials:1.5.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.5.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.1")
}
