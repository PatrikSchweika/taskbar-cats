{
  "targets": [
    {
      "target_name": "win32_shell",
      "sources": ["src/win32_shell.cc"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      # NAPI_VERSION pins the ABI this compiles against. It matters because the
      # binary is built once by CI and then shipped to run under whatever
      # Electron the release happens to bundle: N-API guarantees that only for a
      # version the runtime actually supports, so leaving it to node-addon-api's
      # default would make compatibility a matter of luck.
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_DISABLE_CPP_EXCEPTIONS",
        "UNICODE",
        "_UNICODE"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "libraries": [
              "ole32.lib",
              "oleaut32.lib",
              "uuid.lib",
              "shell32.lib",
              "user32.lib"
            ],
            "msvs_settings": {
              "VCCLCompilerTool": { "AdditionalOptions": ["/std:c++17"] }
            }
          },
          {
            # Nothing to build off Windows. Declared rather than omitted so
            # `npm ci` on Linux succeeds instead of failing on an unknown target.
            "type": "none"
          }
        ]
      ]
    }
  ]
}
