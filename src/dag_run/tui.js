import { Dashboard, DetailReturn } from './dashboard.tsx';
import { installPanel } from './tui-controller.js';
export default { id: 'static-dag.panel', async tui(api) { await installPanel(api, Dashboard, DetailReturn); } };
