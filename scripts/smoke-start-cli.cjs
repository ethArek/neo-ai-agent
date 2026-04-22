const { spawn } = require("node:child_process");

async function main() {
  const child = spawn(process.execPath, ["dist/index.js", "--help"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  let output = "";

  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) {
    throw new Error(
      `CLI smoke test failed with exit code ${exitCode}.\n${output}`,
    );
  }

  if (!output.includes("neo-ai-agent")) {
    throw new Error(
      `CLI smoke test did not print the expected help output.\n${output}`,
    );
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
