import argparse
import subprocess
import sys
import os


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="htdemucs")
    args = parser.parse_args()

    # Debug: Print input parameters
    print(f"Input file: {args.input}", file=sys.stderr)
    print(f"Output directory: {args.output}", file=sys.stderr)
    print(f"Model: {args.model}", file=sys.stderr)

    # Validate input file exists
    if not os.path.isfile(args.input):
        print(f"Error: Input file not found: {args.input}", file=sys.stderr)
        return 1

    # Ensure output directory exists
    os.makedirs(args.output, exist_ok=True)

    cmd = [
        sys.executable,
        "-m",
        "demucs",
        # 4-stem 분리: vocals, drums, bass, other
        "-n", args.model,
        "-o", args.output,
        args.input,
    ]

    print(f"Running command: {' '.join(cmd)}", file=sys.stderr)

    try:
        # Use subprocess.run to get better error handling
        result = subprocess.run(cmd, check=False, capture_output=False)
        print(f"Demucs exit code: {result.returncode}", file=sys.stderr)
        return result.returncode
    except Exception as e:
        print(f"Error running Demucs: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
