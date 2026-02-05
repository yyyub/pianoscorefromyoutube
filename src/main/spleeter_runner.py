import argparse
import subprocess
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--preset", default="spleeter:2stems")
    args = parser.parse_args()

    cmd = [
        sys.executable,
        "-m",
        "spleeter",
        "separate",
        "-p",
        args.preset,
        "-i",
        args.input,
        "-o",
        args.output,
    ]

    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
