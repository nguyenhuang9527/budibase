import { get, writable} from "svelte/store"
import BudiStore from "../BudiStore"

export const INITIAL_CONTEXT_MENU_STATE = {
  items: [],
  position: { x: 0, y: 0 },
  visible: false,
}

const item = {
  icon: "",
  name: "",
  keyBind: "",
  disabled: false,
  visible: true,
  callback: () => {}
}

export function createViewsStore() {
  const store = writable({...INITIAL_CONTEXT_MENU_STATE})

  const open = (items, position) => {
    store.set({ items, position, visible: true })
  }

  const close = () => {
    store.set({ ...INITIAL_CONTEXT_MENU_STATE})
  }

  return {
    subscribe: store.subscribe,
    open,
    close
  }
}

export const contextMenuStore = createViewsStore()
