// The version of the plugin API: the manifest format, the methods an plugin can call, and the messages between the parts.
//
// Rule (the same as for tool contracts): within a version, changes are additive only. A new optional manifest field, a new method,
// a new optional parameter or result field. Removing or changing the meaning of anything is a new version, and the old one keeps
// working for as long as it is listed in SUPPORTED_API_VERSIONS. A manifest names the version it was written for (`apiVersion`).
export const PLUGIN_API_VERSION = 1

export const SUPPORTED_API_VERSIONS: readonly number[] = [1]

export const MANIFEST_FILE = 'subtubes-plugin.json'
