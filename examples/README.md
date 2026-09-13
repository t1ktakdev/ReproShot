# Failing examples

Each project intentionally subtracts a discount percentage as a flat amount. For a price of 50 and a discount of 20%, the implementation returns 30 while the assertion expects 40.

After building ReproShot, run from this repository:

```bash
cd examples/node
node ../../dist/cli.js -- npm test
```

Or use the Python and Rust fixtures:

```bash
cd examples/python
node ../../dist/cli.js -- python3 test_discount.py
# If pytest is already installed:
node ../../dist/cli.js -- pytest
```

```bash
cd examples/rust
node ../../dist/cli.js -- cargo test
```

Use `python` instead of `python3` on Windows where needed. ReproShot does not install runtimes or dependencies.

From the repository root, `npm run demo` refreshes `generated/` and `docs/reproshot.svg` using a real execution of the Node fixture in an isolated Git repository. The fixture prints two clearly fake credentials to demonstrate redaction. They are not real secrets. The bundle records the actual machine, duration and time of capture; those fields will differ on another run.
