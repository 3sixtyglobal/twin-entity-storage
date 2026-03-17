// Copyright 2025 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import { NameOfPlugin } from "@twin.org/nameof-vitest-plugin";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [NameOfPlugin, injectEmitHelpersPlugin()],
	test: {
		include: ["./tests/**/*.spec.ts"],
		globals: true,
		server: {
			deps: {
				inline: [/\/node_modules\/@twin\.org\//]
			}
		},
		testTimeout: 300000,
		hookTimeout: 300000,
		bail: 1,
		reporters: ["verbose"],
		disableConsoleIntercept: true,
		coverage: {
			reporter: ["text", "lcov"],
			include: ["src/**/*.ts"],
			exclude: ["**/index.ts", "**/models/**/*.ts"]
		},
		fileParallelism: false
	}
});

/**
 * Create a transform plugin that prepends code to modules missing decorator helpers.
 * @returns The configured Vite plugin.
 */
function injectEmitHelpersPlugin(): Plugin {
	const helperReferencePattern = /\b(__decorate|__metadata)\b/;
	const helperDefinitionPattern =
		/var (__decorate|__metadata) = \(this && this\.__\w+\) \|\| function/;
	const decoratorEmitterCode = [
		"var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {",
		"\tvar c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;",
		'\tif (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);',
		"\telse for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;",
		"\treturn c > 3 && r && Object.defineProperty(target, key, r), r;",
		"};",
		"var __metadata = (this && this.__metadata) || function (k, v) {",
		'\tif (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);',
		"};"
	].join("\n");

	return {
		name: "inject-test-code",
		enforce: "pre" as const,
		/**
		 * Inject the configured code before Vitest evaluates a module missing decorator helpers.
		 * @param code The original module source.
		 * @param id The module identifier.
		 * @returns The transformed module source when the file matches.
		 */
		transform(code: string, id: string) {
			const normalizedId = id.replaceAll("\\", "/");

			if (
				(!normalizedId.endsWith(".ts") && !normalizedId.endsWith(".js")) ||
				!helperReferencePattern.test(code) ||
				helperDefinitionPattern.test(code)
			) {
				return;
			}

			return {
				code: `${decoratorEmitterCode}\n${code}`,
				map: null
			};
		}
	};
}
