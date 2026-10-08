import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// Vitestではworker用のdev serverを立てられないため、Cloudflare pluginを外す。
export default defineConfig({
	plugins: process.env.VITEST ? [] : [cloudflare()],
});
