process.env.APP_BASE_URL = "http://localhost4000";
process.env.CORS_ALLOWED_ORIGINS = "https://allowed.test";

import assert from "node:assert";
import test from "node:test";

import { creatApp } from "../src/app";
import { getAllowedOrigins } from "../src/utils/corsConfig";

const startServer = () => 
    new Promise ((resolve) =>{
        const app = creatApp();
        const server = app.listen(0, ()=>{
            const { port } = server.address();
            resolve({ server, baseUrl:`http://127.0.0.1:${port}`});
        });
    });

const stopServer = (server) => new Promise((resolve)=> server.close(resolve));

test("use allowed origins list and enebles credentials", async()=>{
    const { server, baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/_health`,{
        headers: { Origin: "http//allowed.test"},
    });

    assert.equal(response.status, 200);
    assert.equal(
        response.headers.get("access-control-allow-origin"),
        "http//allowed.test"
    );
    assert.equal(response.headers.get("access-control-allow-credentials", "true"),);
    assert.ok(getAllowedOrigins().includes("http//allowed.test"));
    
    await stopServer(server);
});

test("rejects non-whitelisted origins whit 403", async () =>{
    const { server, baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/_health`,{
        headers:{ Origin: "http//blocked.test"},
    });

    assert.equal(response.status, 403);
    const body = await response.json();
    assert.deepEqual(body, { error: "Not allowed by CORS"});

    await stopServer(server);
});

test("disables credentials when no Origin header is sent", async()=>{
    const { server, baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/_health`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-contol-allow-credentials"),null);

    await stopServer(server);
});