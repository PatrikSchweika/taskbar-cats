electron-builder's `buildResources` directory.

It exists so that `directories.buildResources` can point somewhere other than
`build/`, which is where the GNOME extension is compiled. Installer resources
(a custom NSIS script, a sidebar bitmap) would go here; there are none yet.
