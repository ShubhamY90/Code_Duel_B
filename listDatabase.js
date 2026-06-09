/**
 * listDatabases.js — lists all Firestore databases in the project
 */
const https = require("https");
const crypto = require("crypto");
const serviceAccount = require("./firebase-service-account.json");

const PROJECT_ID = serviceAccount.project_id;

function base64url(buf) {
    return Buffer.from(buf).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(JSON.stringify({
        iss: serviceAccount.client_email,
        sub: serviceAccount.client_email,
        aud: "https://oauth2.googleapis.com/token",
        iat: now, exp: now + 3600,
        scope: "https://www.googleapis.com/auth/cloud-platform",
    }));
    const signingInput = `${header}.${payload}`;
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(signingInput); sign.end();
    const signature = base64url(sign.sign(serviceAccount.private_key));
    const jwt = `${signingInput}.${signature}`;

    return new Promise((resolve, reject) => {
        const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
        const req = https.request({
            hostname: "oauth2.googleapis.com", path: "/token", method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
        }, (res) => {
            let data = ""; res.on("data", c => data += c);
            res.on("end", () => { const j = JSON.parse(data); j.access_token ? resolve(j.access_token) : reject(new Error(JSON.stringify(j))); });
        });
        req.on("error", reject); req.write(body); req.end();
    });
}

async function listDatabases(token) {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases`;
    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            headers: { Authorization: `Bearer ${token}` }
        }, (res) => {
            let data = ""; res.on("data", c => data += c);
            res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
        });
        req.on("error", reject); req.end();
    });
}

(async () => {
    console.log(`🔥 Project: ${PROJECT_ID}\n`);
    const token = await getAccessToken();
    console.log("✅ Authenticated!\n");
    const result = await listDatabases(token);
    console.log("📋 API Response status:", result.status);
    console.log("📋 Databases found:");
    console.log(JSON.stringify(result.body, null, 2));
})().catch(e => { console.error("Fatal:", e.message); process.exit(1); });