import { get, writable} from "svelte/store"
import { componentStore } from "stores/builder"

const getContextMenuItems = (component) => {

  const definition = componentStore.getDefinition(component?._component)
  const noPaste = !get(componentStore).componentToPaste

  // "editable" has been repurposed for inline text editing.
  // It remains here for legacy compatibility.
  // Future components should define "static": true for indicate they should
  // not show a context menu.
  const showMenu = definition?.editable !== false && definition?.static !== true

  const storeComponentForCopy = (cut = false) => {
    componentStore.copy(component, cut)
  }

  const pasteComponent = mode => {
    try {
      componentStore.paste(component, mode)
    } catch (error) {
      notifications.error("Error saving component")
    }
  }

  return [
    {
      icon: "Copy",
      name: "Copy",
      keyBind: "Ctrl+C",
      visible: true,
      disabled: false,
      callback: () => storeComponentForCopy(false)
    },
    {
      icon: "LayersSendToBack",
      name: "Paste",
      keyBind: "Ctrl+V",
      visible: true,
      disabled: noPaste,
      callback: () => pasteComponent("inside")
    },
  ]
}

export default getContextMenuItems
