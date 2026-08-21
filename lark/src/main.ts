import "./global.css";

import { Framework } from "@lark.js/mvc";
import { enablePlugin, initLarkSentry } from "@lark.js/sentry";
import {
  ScreenRecordPlugin,
  PerformancePlugin,
  ExposurePlugin,
} from "@lark.js/sentry/plugins";

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

if (Framework.isBooted()) {
  initLarkSentry({
    dsn: "/ns3.40-flowmonitor",
    debug: true,
    projectId: "ns3.40-flowmonitor",
    beforePushEventList(eventList) {
      if (!import.meta.env.DEV) {
        console.log("@lark.js/sentry App:", eventList);
        return false;
      }
      return eventList;
    },
  });

  enablePlugin(
    new ScreenRecordPlugin(),
    new PerformancePlugin(),
    new ExposurePlugin(),
  );
}
