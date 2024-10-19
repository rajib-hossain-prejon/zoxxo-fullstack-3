import crypto from 'crypto';

const algorithm = 'aes-256-cbc'; // Using AES encryption
const constantKey = 'your-secret-key'; // Replace this with your secret key

// Create a buffer from the constant key using a hash function
const key = crypto.createHash('sha256').update(constantKey, 'utf8').digest();

// Encrypting text
export function encrypt(text: string) {
  const iv = crypto.randomBytes(16); // Generate a random IV
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + '!' + encrypted;
}

// Decrypting text
export function decrypt(text: string) {
  const splitted = text.split('!');
  const iv = Buffer.from(splitted[0], 'hex');
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(splitted[1], 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
