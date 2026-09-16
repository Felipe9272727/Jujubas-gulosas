/* =========================================================
   Stub de @minecraft/server-ui.
   As respostas dos formularios sao roteirizadas pelo harness
   via queueFormResponse().
   ========================================================= */

const responseQueue = [];
export const shownForms = [];

export function queueFormResponse(response) {
  responseQueue.push(response);
}

export function clearFormQueue() {
  responseQueue.length = 0;
  shownForms.length = 0;
}

export const FormCancelationReason = {
  UserBusy: "UserBusy",
  UserClosed: "UserClosed",
};

class BaseForm {
  constructor(kind) {
    this._kind = kind;
    this._title = undefined;
    this._body = undefined;
    this._buttons = [];
  }
  title(text) {
    if (typeof text !== "string") throw new Error("title() precisa de string");
    this._title = text;
    return this;
  }
  body(text) {
    if (typeof text !== "string") throw new Error("body() precisa de string");
    this._body = text;
    return this;
  }
  button(text, iconPath) {
    if (typeof text !== "string") throw new Error("button() precisa de string");
    this._buttons.push({ text, iconPath });
    return this;
  }
  show(player) {
    if (!player || player.typeId !== "minecraft:player") {
      return Promise.reject(new Error("show() precisa de um player"));
    }
    const snapshot = {
      kind: this._kind,
      title: this._title,
      body: this._body,
      buttons: this._buttons.map((b) => b.text),
      player: player.name,
    };
    shownForms.push(snapshot);

    const queued = responseQueue.shift();
    const response =
      queued === undefined
        ? { canceled: true, cancelationReason: FormCancelationReason.UserClosed, selection: undefined }
        : typeof queued === "number"
        ? { canceled: false, selection: queued }
        : queued;

    if (response.selection !== undefined && response.selection >= snapshot.buttons.length) {
      return Promise.reject(
        new Error(
          `Resposta roteirizada selecionou o botao ${response.selection}, mas o form so tem ${snapshot.buttons.length} botoes`
        )
      );
    }
    return Promise.resolve(response);
  }
}

export class ActionFormData extends BaseForm {
  constructor() {
    super("action");
  }
}

export class MessageFormData extends BaseForm {
  constructor() {
    super("message");
  }
  button1(text) {
    return this.button(text);
  }
  button2(text) {
    return this.button(text);
  }
}

export class ModalFormData extends BaseForm {
  constructor() {
    super("modal");
  }
  textField(label, placeholder) {
    this._buttons.push({ text: label });
    return this;
  }
  toggle(label, def) {
    this._buttons.push({ text: label });
    return this;
  }
  slider(label, min, max, step, def) {
    this._buttons.push({ text: label });
    return this;
  }
  dropdown(label, options, def) {
    this._buttons.push({ text: label });
    return this;
  }
}
