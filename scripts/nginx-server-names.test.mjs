// Regression tests for the nginx server_name rewrite.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";

import { rewrite } from "./nginx-server-names.mjs";

const DOMAINS = ["idkjustmakeitlookgood.gay", "www.idkjustmakeitlookgood.gay"];

// Mirrors the shape certbot leaves behind on the server: a TLS catch-all, a
// named TLS block, certbot's :80 redirect block ending in `return 404`, and
// the :80 default_server that keeps serving the bare IP over plain HTTP.
const CONFIG = `server {
    server_name _ idkjustmakeitlookgood.gay www.idkjustmakeitlookgood.gay;

    location / {
        proxy_pass http://127.0.0.1:3000;
    }

    listen [::]:443 ssl; # managed by Certbot
    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/155-138-194-120.sslip.io/fullchain.pem; # managed by Certbot
}

server {
    server_name 155-138-194-120.sslip.io; # managed by Certbot

    location / {
        proxy_pass http://127.0.0.1:3000;
    }

    listen [::]:443 ssl ipv6only=on; # managed by Certbot
    listen 443 ssl; # managed by Certbot
}

server {
    if ($host = www.idkjustmakeitlookgood.gay) {
        return 301 https://$host$request_uri;
    } # managed by Certbot

    listen 80 ;
    listen [::]:80 ;
    server_name 155-138-194-120.sslip.io idkjustmakeitlookgood.gay www.idkjustmakeitlookgood.gay;
    return 404; # managed by Certbot
}

server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _ idkjustmakeitlookgood.gay www.idkjustmakeitlookgood.gay;

    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
`;

const run = (source = CONFIG) => rewrite(source, DOMAINS);

test("strips the domains from catch-all blocks", () => {
  const { output } = run();
  assert.equal(output.match(/server_name _;/g)?.length, 2);
  assert.ok(!/server_name _ idk/.test(output));
});

test("keeps plain HTTP on the bare IP unredirected", () => {
  const { output } = run();
  // The default_server block must keep proxying rather than gain a redirect.
  const block = output.split("server {").find((b) => b.includes("default_server"));
  assert.ok(block.includes("proxy_pass"));
  assert.ok(!block.includes("return 301"));
});

test("moves the domains onto the named TLS block", () => {
  const { output } = run();
  assert.match(
    output,
    /server_name 155-138-194-120\.sslip\.io idkjustmakeitlookgood\.gay www\.idkjustmakeitlookgood\.gay;/,
  );
});

test("preserves certbot's ownership markers", () => {
  const before = CONFIG.match(/# managed by Certbot/g).length;
  const { output } = run();
  // One marker is intentionally dropped: the `return 404` certbot no longer owns.
  assert.equal(output.match(/# managed by Certbot/g).length, before - 1);
  assert.match(output, /sslip\.io idkjustmakeitlookgood\.gay www\S+; # managed by Certbot/);
});

test("turns the unguarded 404 into a redirect", () => {
  const { output } = run();
  assert.ok(!output.includes("return 404;"));
  assert.match(output, /return 301 https:\/\/\$host\$request_uri; # redirect names/);
});

test("never changes the line count", () => {
  const { output } = run();
  assert.equal(output.split("\n").length, CONFIG.split("\n").length);
});

test("is idempotent", () => {
  const first = run().output;
  const second = rewrite(first, DOMAINS);
  assert.equal(second.output, first);
  assert.equal(second.changes.length, 0);
});

test("leaves an already correct config alone", () => {
  const clean = `server {
    listen 443 ssl;
    server_name example.test;
}
`;
  const { output, changes } = rewrite(clean, ["other.test"]);
  assert.equal(changes.length, 1, "adds the missing name to the TLS block");
  assert.match(output, /server_name example\.test other\.test;/);
});

test("ignores server_name inside comments", () => {
  const commented = `# server_name _ idkjustmakeitlookgood.gay;
server {
    listen 80 default_server;
    server_name _;
}
`;
  const { output, changes } = rewrite(commented, DOMAINS);
  assert.equal(changes.length, 0);
  assert.equal(output, commented);
});
