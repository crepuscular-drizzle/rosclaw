import { createRequire } from "node:module";
import { RosbridgeTransport } from "../extensions/openclaw-plugin/dist/transport/rosbridge/adapter.js";

const require = createRequire(new URL("../extensions/openclaw-plugin/package.json", import.meta.url));
const { WebSocketServer } = require("ws");

const port = 19090;
const seen = [];

const server = new WebSocketServer({ host: "127.0.0.1", port });

server.on("connection", (socket) => {
  socket.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    seen.push(msg);

    if (msg.op === "call_service" && msg.service === "/rosapi/topics") {
      socket.send(JSON.stringify({
        op: "service_response",
        id: msg.id,
        service: msg.service,
        result: true,
        values: {
          topics: ["/cmd_vel", "/battery_state", "/navigate_to_pose/_action/feedback"],
          types: [
            "geometry_msgs/msg/Twist",
            "sensor_msgs/msg/BatteryState",
            "nav2_msgs/action/NavigateToPose_FeedbackMessage",
          ],
        },
      }));
      return;
    }

    if (msg.op === "call_service" && msg.service === "/demo/echo") {
      socket.send(JSON.stringify({
        op: "service_response",
        id: msg.id,
        service: msg.service,
        result: true,
        values: { echoed: msg.args },
      }));
      return;
    }

    if (msg.op === "subscribe" && msg.topic === "/battery_state") {
      setTimeout(() => {
        socket.send(JSON.stringify({
          op: "publish",
          topic: "/battery_state",
          msg: { percentage: 0.82, power_supply_status: 2 },
        }));
      }, 50);
    }
  });
});

await new Promise((resolve) => server.once("listening", resolve));

const transport = new RosbridgeTransport({
  url: `ws://127.0.0.1:${port}`,
  reconnect: false,
});

await transport.connect();

const topics = await transport.listTopics();
console.log("listTopics:", JSON.stringify(topics));

const actions = await transport.listActions();
console.log("listActions:", JSON.stringify(actions));

transport.publish({
  topic: "/cmd_vel",
  type: "geometry_msgs/msg/Twist",
  msg: { linear: { x: 0.2 }, angular: { z: 0 } },
});

const battery = await new Promise((resolve) => {
  const sub = transport.subscribe(
    { topic: "/battery_state", type: "sensor_msgs/msg/BatteryState" },
    (msg) => {
      sub.unsubscribe();
      resolve(msg);
    },
  );
});
console.log("subscribeOnce:", JSON.stringify(battery));

const service = await transport.callService({
  service: "/demo/echo",
  type: "example_interfaces/srv/Trigger",
  args: { message: "hello rosbridge" },
});
console.log("callService:", JSON.stringify(service));

const published = seen.find((msg) => msg.op === "publish" && msg.topic === "/cmd_vel");
console.log("publishedCmdVel:", JSON.stringify(published?.msg));

await transport.disconnect();
await new Promise((resolve) => server.close(resolve));
