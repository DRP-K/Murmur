{
  description = "Development environment for Murmur server";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    rust-overlay.url = "github:oxalica/rust-overlay";
  };

  outputs = inputs:
    inputs.flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [ "x86_64-linux" ];
      perSystem =
        {
          self',
          system,
          ...
        }:
        let
          pkgs = import inputs.nixpkgs {
            inherit system;
            overlays = [ (import inputs.rust-overlay) ];
          };

          cargoToml = builtins.fromTOML (builtins.readFile ./server/Cargo.toml);
          msrv = cargoToml.package.rust-version;

          commonNativeBuildInputs = with pkgs; [
            pkg-config
          ];

          mkRustShell =
            rustToolchain:
            pkgs.mkShell {
              packages = with pkgs; [
                lldb
                nixfmt
                rust-analyzer
                diesel-cli
              ];

              nativeBuildInputs = commonNativeBuildInputs ++ [ rustToolchain ];

              shellHook = ''
                export RUST_BACKTRACE=1
                export RUST_SRC_PATH=${pkgs.rustPlatform.rustLibSrc}
              '';
            };
        in
        {
          devShells.default = self'.devShells.stable;
          devShells.stable = mkRustShell pkgs.rust-bin.stable.${msrv}.default;
          devShells.nightly =
            mkRustShell (pkgs.rust-bin.selectLatestNightlyWith (toolchain: toolchain.default));
          devShells.msrv = mkRustShell pkgs.rust-bin.stable.${msrv}.default;
        };
    };
}
