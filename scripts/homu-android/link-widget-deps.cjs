const { existsSync, mkdirSync, realpathSync, symlinkSync } = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, resolve } = require("node:path");

const manifestPath = resolve("apps/mobile/node_modules/expo-widgets/package.json");
if (!existsSync(manifestPath)) process.exit(0);

const widgets = require(manifestPath);
const widgetModules = resolve(dirname(realpathSync(manifestPath)), "node_modules");
const mobileRequire = createRequire(resolve("apps/mobile/package.json"));
const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));

// Expo Widgets 58's build scripts import packages listed only as dev dependencies.
for (const [dependency, donor] of [
  ["@expo/spawn-async", "@expo/cli"],
  ["resolve-workspace-root", "@expo/config"],
]) {
  const link = resolve(widgetModules, dependency);
  if (
    !widgets.devDependencies?.[dependency] ||
    widgets.dependencies?.[dependency] ||
    existsSync(link)
  ) {
    continue;
  }
  const donorRequire = createRequire(expoRequire.resolve(`${donor}/package.json`));
  const installed = dirname(donorRequire.resolve(`${dependency}/package.json`));
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(installed, link, "dir");
}
