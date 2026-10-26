// src/graph/client/webgpu-stub.ts
// The page draws with WebGL only. three-render-objects (under 3d-force-graph)
// imports WebGPURenderer for an option the page never sets, which would pull
// three's whole WebGPU build (about 570 KB minified) into the bundle; the
// build aliases `three/webgpu` to this module instead (package.json).
export const WebGPURenderer = undefined
