import express, { Request, Response } from 'express';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { signerIdentity } from '@metaplex-foundation/umi';
import { createSignerFromKeypair, publicKey, Transaction, transactionBuilder  } from '@metaplex-foundation/umi';
import { Keypair } from '@solana/web3.js';
import { fetchAssetsByCollection, fetchAsset, addPlugin, updatePlugin } from '@metaplex-foundation/mpl-core';
import { Connection, PublicKey  } from '@solana/web3.js';
import { base58 } from '@metaplex-foundation/umi/serializers';

const app = express();
app.use(express.json());
const port = process.env.PORT || 4000;

const cors = require('cors');
app.use(cors());
const umi = createUmi("https://api.devnet.solana.com", "finalized");

const programId = new PublicKey("metaqbxxUerdq28cj4uG7qd9dJwG3TQh4aGrAFr9wC5");


app.get('/create-wallet', (req, res) => {
  const keypair = Keypair.generate();
  const publicKey = keypair.publicKey.toBase58();
  const secretKey = Array.from(keypair.secretKey);

  res.json({ publicKey, secretKey });
});

app.get('/test', async (req, res) => {

  try {
    const connection = new Connection("https://api.devnet.solana.com", "finalized");

    // Test getting the latest blockhash
    const latestBlockhash = await connection.getLatestBlockhash();
    console.log('Latest Blockhash:', latestBlockhash);

    // Test getting account info
    const testPublicKey = new PublicKey ("AV4CjcpTYnqkxFwij5sUbebw5AGRbpafb9oEgrbEHE8F"); // Replace with a known public key
    const accountInfo = await connection.getAccountInfo(testPublicKey);
    console.log('Account Info:', accountInfo);

    console.log('Connection test successful.');
  } catch (error) {
    console.error('Connection test failed:', error);
  }
});

app.get('/test2', async (req, res) => {
  try {
    const connection = new Connection("https://api.devnet.solana.com", "finalized");
    const collectionPublicKey = new PublicKey("AV4CjcpTYnqkxFwij5sUbebw5AGRbpafb9oEgrbEHE8F");

    // Fetch accounts associated with the collection
    const accounts = await connection.getProgramAccounts(programId, {
      filters: [
        {
          memcmp: {
            offset: 0, // Adjust offset based on the program's data structure
            bytes: collectionPublicKey.toBase58(),
          },
        },
      ],
    });

    // Decode and process account data
    const assets = accounts.map(account => ({
      pubkey: account.pubkey.toBase58(),
      data: account.account.data.toString('utf-8'), // Access the account data directly
    }));

    console.log('Assets by Collection:', assets);
    return assets;
  } catch (error) {
    console.error('Error fetching assets by collection:', error);
    throw error;
  }
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


app.get('/list-assets', async (req, res) => {
  try {
    const collection = publicKey("AV4CjcpTYnqkxFwij5sUbebw5AGRbpafb9oEgrbEHE8F");
    const assetsByCollection = await fetchAssetsByCollection(umi, collection, {
      skipDerivePlugins: false,
    });

    console.log(assetsByCollection)
    console.log('Raw assets data:', assetsByCollection);
      if (assetsByCollection.length === 0) {
        console.log("No assets found");
        return res.json({ success: true, assets: [] });
    }
    const assets = assetsByCollection.map((asset) => ({
      key: asset.key,
      owner: asset.owner,
      updateAuthority: asset.updateAuthority,
      name: asset.name, 
      uri: asset.uri, 
      seq: asset.seq ? asset.seq.toString() : null,
    }));  

    res.json({
      success: true,
      assetsByCollection,
    });
  } catch (error) {
    console.error('Error fetching assets:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching assets',
    });
  }
});

app.post('/stake-asset', async (req, res) => {
  const { assetKey } = req.body;
  const asset = publicKey(assetKey);
  const collection = publicKey("AV4CjcpTYnqkxFwij5sUbebw5AGRbpafb9oEgrbEHE8F");
  const fetchedAsset = await fetchAsset(umi, asset);
  console.log("\nThis is the current state of your Asset Attribute Plugin: ", fetchedAsset.attributes)

  const currentTime = new Date().getTime().toString();

    let tx: Transaction;

    // Check if the Asset has an Attribute Plugin attached to it, if not, add it
    if (!fetchedAsset.attributes) {
        tx = await transactionBuilder().add(addPlugin(umi, {
            asset,
            collection,
            plugin: {
            type: "Attributes",
            attributeList: [
                { key: "staked", value: currentTime },
                { key: "stakedTime", value: "0" },
            ],
            },
        })).add(addPlugin(umi, {
            asset,
            collection,
            plugin: {
                type: "FreezeDelegate",
                frozen: true,
                authority: { type: "UpdateAuthority" }
            }
        })).buildAndSign(umi);
    } else {
        // If it is, fetch the Asset Attribute Plugin attributeList
        const assetAttribute = fetchedAsset.attributes.attributeList;
        // Check if the Asset is already been staked
        const isInitialized = assetAttribute.some(
            (attribute) => attribute.key === "staked" || attribute.key === "stakedTime"
        );

        // If it is, check if it is already staked and if not update the staked attribute
        if (isInitialized) {
            const stakedAttribute = assetAttribute.find(
                (attr) => attr.key === "staked"
            );

            if (stakedAttribute && stakedAttribute.value !== "0") {
                throw new Error("Asset is already staked");
            } else {
                assetAttribute.forEach((attr) => {
                    if (attr.key === "staked") {
                        attr.value = currentTime;
                    }
                });
            }
        } else {
            // If it is not, add the staked & stakedTime attribute
            assetAttribute.push({ key: "staked", value: currentTime });
            assetAttribute.push({ key: "stakedTime", value: "0" });
        }

        // Update the Asset Attribute Plugin and Add the FreezeDelegate Plugin
        tx = await transactionBuilder().add(updatePlugin(umi, {
            asset,
            collection,
            plugin: {
            type: "Attributes",
                attributeList: assetAttribute,
            },
        })).add(addPlugin(umi, {
            asset,
            collection,
            plugin: {
                type: "FreezeDelegate",
                frozen: true,
                authority: { type: "UpdateAuthority" }
            }
        })).buildAndSign(umi);
    }

    // Deserialize the Signature from the Transaction
    console.log(`Asset Staked: https://solana.fm/tx/${base58.deserialize(await umi.rpc.sendTransaction(tx))[0]}?cluster=devnet-alpha`);
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});