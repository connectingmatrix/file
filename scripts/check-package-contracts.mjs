import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredFiles = ['src/storage/types.ts', 'src/storage/artifact-service.ts', 'src/storage/zip-artifact.ts', 'src/storage/supabase-storage.ts'];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
}
const types = fs.readFileSync(path.join(root, 'src/storage/types.ts'), 'utf8');
for (const token of ['FileSignedUrlInput', 'FileResumableUploadSession', 'createResumableUpload']) {
  if (!types.includes(token)) throw new Error(`Storage contract is missing ${token}`);
}
const artifact = fs.readFileSync(path.join(root, 'src/storage/artifact-service.ts'), 'utf8');
for (const token of ['putFileArtifact', 'signedArtifactUrl', 'checksumSha256']) {
  if (!artifact.includes(token)) throw new Error(`Artifact service is missing ${token}`);
}
console.log('file-service contracts ok');
