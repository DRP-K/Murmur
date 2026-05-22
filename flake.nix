{
  description = "Murmur dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            rustc
            cargo
            rust-analyzer
            pkg-config
            gobject-introspection
            glib
            gtk3
            webkitgtk_4_1
            libsoup_3
            openssl
            sqlite
            cacert
          ];

          shellHook = ''
            export PKG_CONFIG_PATH="${pkgs.openssl.dev}/lib/pkgconfig:${pkgs.sqlite.dev}/lib/pkgconfig:$PKG_CONFIG_PATH"
            export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"

            echo "Murmur dev shell ready."
            echo "Run: npm install"
            echo "Then: npm run tauri dev"
          '';
        };
      });
}
