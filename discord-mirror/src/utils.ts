import { GuildMember, Message, MessageFlags } from "discord.js-selfbot-v13";

export function memberHasRole(member: GuildMember, ...roleId: string[]): boolean {
   return member.roles.cache.hasAny(...roleId);
}

export function isSystemMessage(message: Message): boolean {
   return message.system;
}

export function isDirectMessage(message: Message): boolean {
   return !message.guild;
}

export function isVisibleOnlyByClient(message: Message): boolean {
   return message.flags.has(MessageFlags.FLAGS.EPHEMERAL);
}

export function isEmptyMessage(message: Message): boolean {
   return message.content.length == 0 && message.embeds.length == 0 && message.attachments.size == 0;
}

export function isGif(message: Message): boolean {
   return message.embeds.length == 1 && message.embeds.at(0)?.provider != null;
}

export function containsOnlyAttachments(message: Message): boolean {
   return message.attachments.size > 0 && !message.content.length && !message.embeds.length;
}

export function isString(value: any): boolean {
   return typeof value === "string";
}

export function isValidHexColor(color: string): boolean {
   return /^#[0-9A-F]{6}$/i.test(color);
}

export function hexColorsAreEqual(hexColorA: string, hexColorB: string, epsilon: number = 3000) {
   const colorA = parseInt(hexColorA.slice(1));
   const colorB = parseInt(hexColorB.slice(1));
   return Math.abs(colorA - colorB) <= epsilon;
}
