import { Helpers } from "@budibase/bbui"
import { BaseStructure } from "./BaseStructure"

export class Component extends BaseStructure {
  constructor(name, _id = Helpers.uuid()) {
    super(false)
    this._children = []
    this._json = {
      _id,
      _component: name,
      _styles: {
        normal: {},
        hover: {},
        active: {},
        selected: {},
      },
      _instanceName: "",
      _children: [],
    }
  }

  normalStyle(styling) {
    this._json._styles.normal = styling
    return this
  }

  hoverStyle(styling) {
    this._json._styles.hover = styling
    return this
  }

  customStyle(styling) {
    this._json._styles.custom = styling
    return this
  }

  instanceName(name) {
    this._json._instanceName = name
    return this
  }

  // Shorthand for custom props "type"
  type(type) {
    this._json.type = type
    return this
  }

  // Shorthand for custom props "text"
  text(text) {
    this._json.text = text
    return this
  }

  getId() {
    return this._json._id
  }
}
