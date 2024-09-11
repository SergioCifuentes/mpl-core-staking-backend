import express, { Request, Response } from 'express';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { signerIdentity } from '@metaplex-foundation/umi';
import { createSignerFromKeypair } from '@metaplex-foundation/umi';
import { Keypair } from '@solana/web3.js';

const app = express();
app.use(express.json());
const port = process.env.PORT || 3000;

const umi = createUmi("https://api.devnet.solana.com", "finalized");

app.get('/create-wallet', (req, res) => {
    const keypair = Keypair.generate();
  const publicKey = keypair.publicKey.toBase58();
  const secretKey = Array.from(keypair.secretKey);

  res.json({ publicKey, secretKey });
});

app.post('/connect-wallet', (req, res) => {
  const { secretKeyArray } = req.body;

  if (!secretKeyArray) {
    return res.status(400).json({ error: 'Secret key array required' });
  }

  const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(secretKeyArray));
  const signer = createSignerFromKeypair(umi, keypair);
  umi.use(signerIdentity(signer));

  res.json({ message: 'Wallet connected', publicKey: keypair.publicKey.toString() });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});