// Keep import, editing and mesh-generation budgets consistent.
export const PATH_VERTEX_LIMIT = 6000;
export const EDITOR_RAW_VERTEX_LIMIT = 40000;
export const TOTAL_RAW_VERTEX_LIMIT = 200000;
// Editing UI should not wait for dense 3D builds or thousands of point nodes.
export const EDITOR_PREVIEW_VERTEX_LIMIT = 3000;
