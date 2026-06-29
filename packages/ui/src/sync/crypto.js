// Encrypt/decrypt sync payloads with a pre-derived key (hex), reusing core AES-GCM.
import { encryptConfidentialForServer, decryptConfidentialFromServer } from '@nexusmd/core';

const FORMAT = 'nexusmd-sync';
const VERSION = 1;

export async function encryptSync(obj, keyHex) {
  const { iv, ciphertext } = await encryptConfidentialForServer(obj, keyHex);
  return JSON.stringify({ format: FORMAT, version: VERSION, iv, ciphertext });
}

export async function decryptSync(text, keyHex) {
  const w = JSON.parse(text);
  if (!w || w.format !== FORMAT || !w.iv || !w.ciphertext) throw new Error('not a sync payload');
  return decryptConfidentialFromServer({ iv: w.iv, ciphertext: w.ciphertext }, keyHex);
}
