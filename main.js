import { createSSRApp } from 'vue'
import App from './App.vue'
import RegionPicker from './components/RegionPicker.vue'
import {isModuleEnabled, isPageModuleEnabled, filterModuleEntries} from './services/modules'
import {installModuleNavigation} from './utils/moduleNavigation'
// #ifdef H5
import { installDesktopChat } from './utils/desktopChatMount'
// #endif

export function createApp() {
  const app = createSSRApp(App)
  app.component('RegionPicker', RegionPicker)
  app.mixin({methods:{isModuleEnabled,isPageModuleEnabled,filterModuleEntries}})
  installModuleNavigation()
  // #ifdef H5
  installDesktopChat(app)
  // #endif
  return { app }
}
