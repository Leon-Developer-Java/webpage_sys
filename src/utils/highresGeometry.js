// Canonical high-resolution topology, shared by the request and map anchor.
export function highresDomains() {
  const shapes = [[100,79],[79,61],[64,46],[55,40],[37,37],[43,43],[64,64],[127,127]];
  const starts = [[1,1],[11,11],[6,6],[6,6],[22,15],[11,11],[11,11],[11,11]];
  return shapes.map(([e_we,e_sn], i) => ({ name: `d${String(i+1).padStart(2,"0")}`, dx_m:27000/3**i, dy_m:27000/3**i, parent_grid_ratio:i ? 3 : 1, e_we,e_sn,parent_start_i:starts[i][0],parent_start_j:starts[i][1] }));
}
export function highresReferencePoint() {
  const domains = highresDomains();
  let grid_x = (domains.at(-1).e_we + 1)/2;
  let grid_y = (domains.at(-1).e_sn + 1)/2;
  for (const d of domains.slice(1).reverse()) {
    grid_x = d.parent_start_i + (grid_x-1)/d.parent_grid_ratio;
    grid_y = d.parent_start_j + (grid_y-1)/d.parent_grid_ratio;
  }
  return {grid_x,grid_y};
}
