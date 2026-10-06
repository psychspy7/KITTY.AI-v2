import { ApiError } from "./types";
const bytes = (value: string) =>
  Uint8Array.from(atob(value), (x) => x.charCodeAt(0));
const base64 = (value: Uint8Array) => {
  let text="";
  for(let i=0;i<value.length;i+=8192)text+=String.fromCharCode(...value.subarray(i,i+8192));
  return btoa(text);
};
async function key(secret?: string) {
  if (!secret) throw new ApiError(503, "Provider vault is not configured.");
  const data = bytes(secret);
  if (data.length !== 32)
    throw new ApiError(503, "Provider vault key must be 32 bytes.");
  return crypto.subtle.importKey("raw", data, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function seal(
  value: string,
  secret: string | undefined,
  providerId: string,
) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(providerId),
    },
    await key(secret),
    new TextEncoder().encode(value),
  );
  return `${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}
export async function unseal(
  value: string,
  secret: string | undefined,
  providerId: string,
) {
  const [iv, ciphertext] = value.split(".");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: bytes(iv),
        additionalData: new TextEncoder().encode(providerId),
      },
      await key(secret),
      bytes(ciphertext),
    ),
  );
}
