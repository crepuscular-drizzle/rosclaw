# RosClaw ROS2/Gazebo Demo 复现记录

本文记录在 WSL + Docker 环境下复现 RosClaw ROS2/Gazebo demo 的过程。Docker 主线验证目标是：

```text
ROS2 /cmd_vel
-> ros_gz_bridge
-> Gazebo TurtleBot3
-> /odom 反馈
```

文档末尾另有可选的宿主机 RosClaw TypeScript transport 验证，用于确认插件可以通过 `ws://127.0.0.1:9090` 控制 Gazebo 中的 TurtleBot3。

## 复现结论

已成功复现核心链路：

- rosbridge WebSocket 服务启动成功，端口为 `9090`
- TurtleBot3 Gazebo 以 headless 方式启动成功
- ROS-Gazebo bridge 启动成功
- ROS2 可读取 `/odom`、`/scan`、`/imu` 等 topic
- 容器内可通过 `/cmd_vel` 控制 TurtleBot3
- 可选验证中，宿主机可通过 RosClaw TypeScript rosbridge transport 发布 `/cmd_vel`，并驱动 Gazebo 中的 TurtleBot3

## 环境准备

### Docker 权限

如果普通用户执行 Docker 报错：

```text
permission denied while trying to connect to the docker API at unix:///var/run/docker.sock
```

可临时使用 `sudo`：

```bash
sudo docker ps
```

长期方案是把当前用户加入 `docker` 组：

```bash
sudo usermod -aG docker $USER
newgrp docker
```

WSL 环境还需要在 Docker Desktop 中开启当前发行版的 WSL Integration。

## 仓库配置修正

`docker/docker-compose.yml` 中 `ros2` 服务需要使用仓库根目录作为 build context，同时 Dockerfile 路径要指向 `docker/Dockerfile.ros2`：

```yaml
ros2:
  build:
    context: ..
    dockerfile: docker/Dockerfile.ros2
```

如果写成 `dockerfile: Dockerfile.ros2`，Docker 会在仓库根目录寻找 `Dockerfile.ros2`，导致：

```text
failed to read dockerfile: open Dockerfile.ros2: no such file or directory
```

## 启动 rosbridge

在仓库根目录执行：

```bash
sudo docker compose -f docker/docker-compose.yml up --build ros2
```

看到以下日志表示 rosbridge 已启动：

```text
Rosbridge WebSocket server started on port 9090
```

此时容器默认只启动 rosbridge/rosapi，不会自动启动 TurtleBot3 Gazebo。

## 启动 TurtleBot3 Headless Gazebo

进入容器：

```bash
sudo docker exec -it docker-ros2-1 bash
```

如果容器名不同，先查看：

```bash
sudo docker ps
```

在容器内 source 环境：

```bash
source /opt/ros/jazzy/setup.bash
source /ros2_ws/install/setup.bash
export TURTLEBOT3_MODEL=burger
export GZ_SIM_RESOURCE_PATH=/opt/ros/jazzy/share/turtlebot3_gazebo/models:/opt/ros/jazzy/share/turtlebot3_gazebo/worlds:/opt/ros/jazzy/share
```

启动 Gazebo server，注意这里不启动 GUI：

```bash
gz sim -r -s -v2 /opt/ros/jazzy/share/turtlebot3_gazebo/worlds/turtlebot3_world.world
```

### GUI 失败说明

直接运行：

```bash
ros2 launch turtlebot3_gazebo turtlebot3_world.launch.py
```

或：

```bash
ros2 launch turtlebot3_gazebo turtlebot3_world.launch.py gui:=false
```

在当前 Docker 环境会失败，典型错误是：

```text
qt.qpa.xcb: could not connect to display
Could not load the Qt platform plugin "xcb"
```

原因是该 launch 文件没有 `gui` 参数，`gui:=false` 不生效，仍会启动 `gz sim -g`。可通过以下命令确认参数：

```bash
ros2 launch turtlebot3_gazebo turtlebot3_world.launch.py --show-args
```

因此本次采用手动 headless 启动。

## 创建机器人

保持 Gazebo server 终端运行，另开一个宿主机终端进入同一容器：

```bash
sudo docker exec -it docker-ros2-1 bash
```

在容器内执行：

```bash
source /opt/ros/jazzy/setup.bash
source /ros2_ws/install/setup.bash
export TURTLEBOT3_MODEL=burger
export GZ_SIM_RESOURCE_PATH=/opt/ros/jazzy/share/turtlebot3_gazebo/models:/opt/ros/jazzy/share/turtlebot3_gazebo/worlds:/opt/ros/jazzy/share
```

创建 TurtleBot3：

```bash
ros2 run ros_gz_sim create \
  -name burger \
  -file /opt/ros/jazzy/share/turtlebot3_gazebo/models/turtlebot3_burger/model.sdf \
  -x -2.0 -y -0.5 -z 0.01
```

成功时会看到：

```text
Entity creation successful.
```

## 启动 ROS-Gazebo Bridge

继续在容器内执行：

```bash
ros2 run ros_gz_bridge parameter_bridge \
  /clock@rosgraph_msgs/msg/Clock[gz.msgs.Clock \
  /joint_states@sensor_msgs/msg/JointState[gz.msgs.Model \
  /odom@nav_msgs/msg/Odometry[gz.msgs.Odometry \
  /tf@tf2_msgs/msg/TFMessage[gz.msgs.Pose_V \
  /cmd_vel@geometry_msgs/msg/TwistStamped]gz.msgs.Twist \
  /imu@sensor_msgs/msg/Imu[gz.msgs.IMU \
  /scan@sensor_msgs/msg/LaserScan[gz.msgs.LaserScan
```

成功时会看到多行：

```text
Creating GZ->ROS Bridge
Creating ROS->GZ Bridge: [/cmd_vel ...]
```

保持该 bridge 终端运行。

## 验证 ROS2 Topic

另开一个容器终端：

```bash
sudo docker exec -it docker-ros2-1 bash
source /opt/ros/jazzy/setup.bash
source /ros2_ws/install/setup.bash
```

查看 topic：

```bash
ros2 topic list
```

期望至少出现：

```text
/clock
/cmd_vel
/imu
/joint_states
/odom
/scan
/tf
```

读取里程计：

```bash
ros2 topic echo /odom --once
```

读取雷达：

```bash
ros2 topic echo /scan --once
```

## 容器内控制机器人

发布速度命令：

```bash
timeout 3 ros2 topic pub /cmd_vel geometry_msgs/msg/TwistStamped \
"{header: {frame_id: ''}, twist: {linear: {x: 0.2}, angular: {z: 0.0}}}"
```

再查看 `/odom`：

```bash
ros2 topic echo /odom --once
```

本次复现中，`position.x` 从接近 `0` 增加到约 `2.39`，`twist.linear.x` 约为 `0.2`，说明机器人已经移动。

停止机器人：

```bash
ros2 topic pub --once /cmd_vel geometry_msgs/msg/TwistStamped \
"{header: {frame_id: ''}, twist: {linear: {x: 0.0}, angular: {z: 0.0}}}"
```

## 常见问题

### Docker socket 权限不足

错误：

```text
permission denied while trying to connect to the docker API
```

处理：

```bash
sudo docker ...
```

或将用户加入 `docker` 组。

### Dockerfile.ros2 找不到

错误：

```text
failed to read dockerfile: open Dockerfile.ros2: no such file or directory
```

处理：确认 `docker/docker-compose.yml` 中配置为：

```yaml
build:
  context: ..
  dockerfile: docker/Dockerfile.ros2
```

### Gazebo GUI 崩溃

错误：

```text
qt.qpa.xcb: could not connect to display
```

处理：不要启动 GUI，使用：

```bash
gz sim -r -s -v2 /opt/ros/jazzy/share/turtlebot3_gazebo/worlds/turtlebot3_world.world
```

### 找不到 Gazebo 模型

错误：

```text
Unable to find uri[model://turtlebot3_world]
```

处理：

```bash
export GZ_SIM_RESOURCE_PATH=/opt/ros/jazzy/share/turtlebot3_gazebo/models:/opt/ros/jazzy/share/turtlebot3_gazebo/worlds:/opt/ros/jazzy/share
```

### `/cmd_vel` 类型

本环境下 `/cmd_vel` 类型是：

```text
geometry_msgs/msg/TwistStamped
```

不是常见的：

```text
geometry_msgs/msg/Twist
```

发布命令时需要使用 `TwistStamped`。

## 可选：宿主机 RosClaw TypeScript 验证

本节用于验证宿主机上的 RosClaw TypeScript transport 可以通过 rosbridge 控制 Docker 中的 ROS2/Gazebo。它不是 Docker/Gazebo 主线复现的必要步骤。

验证链路：

```text
宿主机 Node
-> RosClaw TypeScript RosbridgeTransport
-> ws://127.0.0.1:9090
-> rosbridge_server
-> ROS2 /cmd_vel
-> ros_gz_bridge
-> Gazebo TurtleBot3
-> /odom 反馈
```

### Node/pnpm

推荐直接安装并使用正式的 Node 20 环境。项目根目录的 `package.json` 要求：

```text
node >= 20.0.0
pnpm >= 9.0.0
```

推荐使用 `nvm` 管理 Node 版本：

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

重新打开终端后执行：

```bash
nvm install 20
nvm use 20
node --version
```

启用 pnpm：

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm --version
```

项目依赖安装：

```bash
pnpm install
```

说明：`rclnodejs` 是 optional dependency。若本机没有 source ROS 环境，它可能编译失败，但不影响 rosbridge 路径验证。

如果只是临时复现，也可以把 Node 20 解压到 `/tmp/rosclaw-node` 并在命令前加：

```bash
PATH=/tmp/rosclaw-node/bin:$PATH
```

但该方式不适合长期使用，因为 `/tmp` 可能被清理，新终端也不会自动继承该 PATH。

### 通过 RosClaw Transport 控制机器人

先编译插件：

```bash
pnpm --filter @rosclaw/rosclaw exec tsc
```

从宿主机通过 rosbridge 发布 `/cmd_vel`：

```bash
node -e "import('./extensions/openclaw-plugin/dist/transport/rosbridge/adapter.js').then(async ({RosbridgeTransport}) => { const t = new RosbridgeTransport({url:'ws://127.0.0.1:9090', reconnect:false}); await t.connect(); console.log(await t.listTopics()); t.publish({topic:'/cmd_vel', type:'geometry_msgs/msg/TwistStamped', msg:{header:{frame_id:''}, twist:{linear:{x:0.2}, angular:{z:0}}}}); await new Promise(r=>setTimeout(r,1000)); await t.disconnect(); })"
```

期望输出包含真实 ROS2 topics：

```text
{ name: '/cmd_vel', type: 'geometry_msgs/msg/TwistStamped' }
{ name: '/odom', type: 'nav_msgs/msg/Odometry' }
{ name: '/scan', type: 'sensor_msgs/msg/LaserScan' }
```

然后在容器中查看：

```bash
ros2 topic echo /odom --once
```

本次复现中，`twist.linear.x` 为约 `0.2`，说明宿主机 RosClaw TypeScript transport 已通过 rosbridge 控制 Gazebo TurtleBot3。

停止机器人：

```bash
node -e "import('./extensions/openclaw-plugin/dist/transport/rosbridge/adapter.js').then(async ({RosbridgeTransport}) => { const t = new RosbridgeTransport({url:'ws://127.0.0.1:9090', reconnect:false}); await t.connect(); t.publish({topic:'/cmd_vel', type:'geometry_msgs/msg/TwistStamped', msg:{header:{frame_id:''}, twist:{linear:{x:0}, angular:{z:0}}}}); await t.disconnect(); })"
```

### 轻量 rosbridge Mock 复现

项目中也增加了一个不依赖 Docker/ROS2 的轻量复现脚本：

```bash
pnpm reproduce:rosbridge
```

该脚本会启动本地 mock rosbridge，并验证：

- `listTopics`
- `listActions`
- `publish`
- `subscribe`
- `callService`

这适合作为 TypeScript rosbridge transport 的快速回归验证。
