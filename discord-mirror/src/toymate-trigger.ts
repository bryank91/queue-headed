import { ChildProcess, fork } from "child_process";
import path from "path";
import { Message, WebhookClient } from "discord.js-selfbot-v13";
import { Config, ToymateNotificationConfig, ToymateTriggerConfig } from "./config";

interface ToymateStatus {
   source?: string;
   type?: string;
   [key: string]: unknown;
}

export interface ToymateTriggerMessage {
   channelId: string;
   authorId: string;
   content: string;
   embedUrls?: string[];
   embedText?: string[];
}

export function matchesToymateTrigger(message: ToymateTriggerMessage, settings: ToymateTriggerConfig): boolean {
   const channelIds = settings.channelIds ?? [];
   if (!channelIds.includes(message.channelId)) return false;

   const authorIds = settings.authorIds ?? [];
   if (authorIds.length && !authorIds.includes(message.authorId)) return false;

   // Searchable text covers the message content plus everything the link may
   // hide in: embed URLs, embed titles/descriptions, and embed field text.
   const searchableText = [message.content, ...(message.embedUrls ?? []), ...(message.embedText ?? [])]
      .filter(Boolean).join("\n").trim();

   if ((settings.contentEquals ?? []).some((value) => searchableText === value)) return true;
   if ((settings.contentIncludes ?? []).some((value) => searchableText.includes(value))) return true;

   if (settings.regex) {
      try {
         return new RegExp(settings.regex, "i").test(searchableText);
      } catch (error) {
         console.error("[Toymate] Invalid trigger regex in YAML:", error);
      }
   }

   return false;
}

export class ToymateTrigger {
   private readonly settings: ToymateTriggerConfig;
   private readonly notifications: ToymateNotificationConfig;
   private readonly webhooks: WebhookClient[];
   private watcher: ChildProcess | null = null;
   private lastTriggeredAt = 0;

   public constructor(private readonly config: Config) {
      this.settings = config.getToymateTrigger();
      this.notifications = this.settings.notifications ?? {};
      this.webhooks = (this.notifications.webhookUrls ?? [])
         .filter(Boolean)
         .map((url) => new WebhookClient({ url }));
   }

   public handleMessage(message: Message): void {
      if (!this.settings.enabled || !this.matches(message)) {
         return;
      }

      if (this.isRunning()) {
         console.log("[Toymate] Trigger ignored because a watcher is already running.");
         return;
      }

      const cooldownMs = Math.max(0, this.settings.cooldownSeconds ?? 0) * 1000;
      if (Date.now() - this.lastTriggeredAt < cooldownMs) {
         console.log("[Toymate] Trigger ignored because the cooldown is active.");
         return;
      }

      this.lastTriggeredAt = Date.now();
      this.startWatcher();
   }

   private matches(message: Message): boolean {
      const embedText: string[] = [];
      const embedUrls: string[] = [];
      for (const embed of message.embeds) {
         if (embed.title) embedText.push(embed.title);
         if (embed.description) embedText.push(embed.description);
         if (embed.url) embedUrls.push(embed.url);
         for (const field of embed.fields ?? []) {
            if (field.name) embedText.push(field.name);
            if (field.value) embedText.push(field.value);
         }
      }
      return matchesToymateTrigger({
         channelId: message.channelId,
         authorId: message.author.id,
         content: message.content,
         embedUrls,
         embedText,
      }, this.settings);
   }

   private isRunning(): boolean {
      return this.watcher !== null && this.watcher.exitCode === null;
   }

   private startWatcher(): void {
      const watcherPath = this.resolvePath(this.settings.watcherPath);
      const watcherConfigPath = this.resolvePath(this.settings.watcherConfigPath);
      const workingDirectory = this.resolvePath(this.settings.workingDirectory ?? path.dirname(watcherPath));

      console.log("[Toymate] Starting watcher:", watcherPath);

      let child: ChildProcess;
      try {
         child = fork(watcherPath, [], {
            cwd: workingDirectory,
            env: {
               ...process.env,
               TOYMATE_CONFIG_PATH: watcherConfigPath,
            },
            stdio: ["ignore", "pipe", "pipe", "ipc"],
         });
      } catch (error) {
         console.error("[Toymate] Failed to start watcher:", error);
         void this.postError(String(error));
         return;
      }

      this.watcher = child;
      let childReportedError = false;

      child.stdout?.on("data", (data: Buffer) => process.stdout.write(`[Toymate] ${data}`));
      child.stderr?.on("data", (data: Buffer) => process.stderr.write(`[Toymate] ${data}`));
      child.on("message", (status: ToymateStatus) => {
         if (status?.type === "error") childReportedError = true;
         void this.handleStatus(status);
      });
      child.on("error", (error) => {
         childReportedError = true;
         void this.postError(error.message);
      });
      child.on("exit", (code, signal) => {
         if (this.watcher === child) this.watcher = null;
         if (code !== 0 && !childReportedError) {
            void this.postError(`Watcher exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`);
         }
      });
   }

   private async handleStatus(status: ToymateStatus): Promise<void> {
      if (!status || status.source !== "toymate") return;

      switch (status.type) {
         case "started":
            if (this.notifications.postStarted !== false) {
               await this.post(`🟡 Toymate watcher started with ${status.profiles ?? "configured"} profile(s).`);
            }
            break;
         case "waiting_room":
            if (this.notifications.postWaitingRoom) {
               await this.post(`⏳ Toymate profile ${status.profile ?? "?"}/${status.total ?? "?"} entered the Cloudflare queue.`);
            }
            break;
         case "cleared":
            if (this.notifications.postCleared !== false) {
               await this.post(`✅ Toymate queue cleared — profile ${status.profile ?? "?"}/${status.total ?? "?"} is through.`);
            }
            break;
         case "stopped":
            if (this.notifications.postStopped !== false) {
               await this.post(`ℹ️ Toymate watcher stopped (${status.reason ?? "complete"}).`);
            }
            break;
         case "error":
            await this.postError(String(status.message ?? "Unknown watcher error."));
            break;
      }
   }

   private async postError(message: string): Promise<void> {
      if (this.notifications.postErrors !== false) {
         await this.post(`⚠️ Toymate watcher error: ${message}`);
      }
   }

   private async post(content: string): Promise<void> {
      if (!this.notifications.enabled || !this.webhooks.length) return;
      await Promise.all(this.webhooks.map((webhook) =>
         webhook.send({ content }).catch((error) => {
            console.error("[Toymate] Failed to send Discord notification:", error.message);
         })
      ));
   }

   private resolvePath(configuredPath: string | undefined): string {
      if (!configuredPath) {
         throw new Error("Toymate trigger path is missing from YAML config.");
      }
      return path.isAbsolute(configuredPath)
         ? configuredPath
         : path.resolve(this.config.getConfigDirectory(), configuredPath);
   }
}
