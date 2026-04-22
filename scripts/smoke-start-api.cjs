const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("Unable to allocate a free TCP port."));

        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);

          return;
        }

        resolve(address.port);
      });
    });
  });
}

function requestHealth(port) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        port,
        path: "/health",
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );

    request.once("error", reject);
  });
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 10000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `API smoke test exited early with code ${child.exitCode}.`,
      );
    }

    try {
      const statusCode = await requestHealth(port);

      if (statusCode === 200) {
        return;
      }
    } catch {
      // Keep polling until the server is ready or the timeout expires.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  }

  throw new Error("API smoke test timed out waiting for /health.");
}

async function main() {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["dist/server.js"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      API_HOST: "127.0.0.1",
      NODE_ENV: "test",
      PORT: String(port),
    },
  });
  let output = "";

  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    await waitForHealth(port, child);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("exit", resolve);
    });
  }

  if (!output.includes("REST API is listening")) {
    throw new Error(
      `API smoke test did not observe the startup log.\n${output}`,
    );
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
