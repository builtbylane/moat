import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Moat',
  short_name: 'Moat',
  description: 'Block distracting sites with a clean toggle and a one-click 1-hour focus mode.',
  version: pkg.version,
  icons: {
    16: 'src/assets/icon-16.png',
    48: 'src/assets/icon-48.png',
    128: 'src/assets/icon-128.png',
  },
  action: {
    default_popup: 'src/popup/popup.html',
    default_title: 'Moat',
    default_icon: {
      16: 'src/assets/icon-16.png',
      48: 'src/assets/icon-48.png',
      128: 'src/assets/icon-128.png',
    },
  },
  options_ui: {
    page: 'src/options/options.html',
    open_in_tab: true,
  },
  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },
  permissions: [
    'storage',
    'declarativeNetRequest',
    'declarativeNetRequestWithHostAccess',
    'alarms',
    'activeTab',
    'webNavigation',
  ],
  host_permissions: ['<all_urls>'],
  web_accessible_resources: [
    {
      resources: ['src/blocked/blocked.html'],
      matches: ['<all_urls>'],
    },
  ],
  commands: {
    'toggle-blocking': {
      suggested_key: { default: 'Ctrl+Shift+M', mac: 'Command+Shift+M' },
      description: 'Toggle Moat blocking',
    },
  },
});
