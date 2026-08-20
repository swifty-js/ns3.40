import { Framework } from "@lark.js/mvc";

export default function boot() {
  Framework.boot({
    rootId: "app",
    routeMode: "hash",
    defaultPath: "/dashboard",
    defaultView: "dashboard",
    routes: {
      "/dashboard": "dashboard",
      "/scenario": "scenario",
    },
    unmatchedView: "dashboard",
    require: async (names: string[]) =>
      Promise.all(
        names.map((n) => import(`./views/${n}.ts`).then((m) => m.default)),
      ),
  });
}
