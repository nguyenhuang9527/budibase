import { get, writable} from "svelte/store"
import { screenStore, componentStore, navigationStore } from "stores/builder"
import sanitizeUrl from "helpers/sanitizeUrl"
import { makeComponentUnique } from "helpers/components"
import { capitalise } from "helpers"
  import {
    notifications,
  } from "@budibase/bbui"

const getContextMenuItems = (screen, duplicateScreen, deleteScreen) => {
  const noPaste = !get(componentStore).componentToPaste

  const pasteComponent = mode => {
    try {
      componentStore.paste(screen.props, mode, screen)
    } catch (error) {
      notifications.error("Error saving component")
    }
  }

  return [
    {
      icon: "ShowOneLayer",
      name: "Paste inside",
      keyBind: null,
      visible: true,
      disabled: noPaste,
      callback: () => pasteComponent("inside")
    },
    {
      icon: "Duplicate",
      name: "Duplicate",
      keyBind: null,
      visible: true,
      disabled: false,
      callback: () => duplicateScreen(screen)
    },
    {
      icon: "Delete",
      name: "Delete",
      keyBind: null,
      visible: true,
      disabled: false,
      callback: () => deleteScreen(screen)
    },
  ]
}

export default getContextMenuItems
