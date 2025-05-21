import { execFile } from "child_process";

export const runGitPull = (
  directory: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", directory, "pull"],
      {
        timeout: 10000,
        env: {
          PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
          ...process.env,
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          resolve({
            exitCode: typeof error.code === "number" ? error.code : 1,
            stdout,
            stderr: stderr || error.message,
          });
        } else {
          resolve({ exitCode: 0, stdout, stderr });
        }
      },
    );
  });
};
