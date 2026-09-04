import "./global.css";

import { render, createRouter, RouterView } from "@lark.js/mvc";
import { initLarkSentry, enablePlugin } from "@lark.js/sentry";
import {
  ScreenRecordPlugin,
  PerformancePlugin,
  ExposurePlugin,
} from "@lark.js/sentry/plugins";
import Dashboard from "./views/dashboard";

const basename = import.meta.env.BASE_URL.replace(/\/+$/, "");

const router = createRouter(
  [
    { path: "/", component: Dashboard },
    { path: "/dashboard", component: Dashboard },
    { path: "/scenario", lazy: () => import("./views/scenario") },
    { path: "*", component: Dashboard },
  ],
  { basename },
);

initLarkSentry(
  {
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
  },
  router,
);

enablePlugin(
  new ScreenRecordPlugin(),
  new PerformancePlugin(),
  new ExposurePlugin(),
);

render(<RouterView router={router} />, document.getElementById("app")!);
