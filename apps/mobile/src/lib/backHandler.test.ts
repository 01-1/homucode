import { expect, it, vi } from "vite-plus/test";

vi.mock("@react-navigation/native", () => ({}));
vi.mock("react-native", () => ({}));
vi.mock("../components/ui/Pane", () => ({}));

const { dispatchTaskHardwareBack, registerTaskHardwareBack } = await import("./backHandler");

it("gives Back to the foreground task's handlers in reverse registration order", () => {
  const mainTab = vi.fn(() => true);
  const mainSearch = vi.fn(() => false);
  const launcher = vi.fn(() => true);
  using _mainTab = { [Symbol.dispose]: registerTaskHardwareBack("main", mainTab) };
  using _mainSearch = { [Symbol.dispose]: registerTaskHardwareBack("main", mainSearch) };
  using _launcher = { [Symbol.dispose]: registerTaskHardwareBack("madohomu", launcher) };

  expect(dispatchTaskHardwareBack("madohomu")).toBe(true);
  expect(launcher).toHaveBeenCalledOnce();
  expect(mainTab).not.toHaveBeenCalled();
  expect(mainSearch).not.toHaveBeenCalled();

  expect(dispatchTaskHardwareBack("main")).toBe(true);
  expect(mainSearch).toHaveBeenCalledBefore(mainTab);
  expect(launcher).toHaveBeenCalledOnce();
});
