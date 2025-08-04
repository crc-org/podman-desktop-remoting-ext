'use strict';

Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

const extensionApi = require('@podman-desktop/api');

function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: 'Module' } });
  if (e) {
    for (const k in e) {
      if (k !== 'default') {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}

const extensionApi__namespace = /*#__PURE__*/_interopNamespaceDefault(extensionApi);

const SECOND = 1e9;
const path = require("path");
const fs = require("fs");
const async_fs = require("fs/promises");
const AvailableModels = {};
let ExtensionStoragePath = void 0;
const EXTENSION_BUILD_PATH = path.parse(__filename).dir + "/../build";
let RamalamaRemotingImage = void 0;
let ApirVersion = void 0;
let LocalBuildDir = void 0;
const MAIN_MENU_CHOICES = {
  "Restart PodMan Machine with API Remoting support": () => restart_podman_machine_with_apir(),
  "Restart PodMan Machine with the default configuration": () => restart_podman_machine_without_apir(),
  "Launch an API Remoting accelerated Inference Server": () => launchApirInferenceServer(),
  "Check  PodMan Machine API Remoting status": () => checkPodmanMachineStatus(true)
};
function registerFromDir(startPath, filter, register) {
  if (!fs.existsSync(startPath)) {
    console.log("no dir ", startPath);
    return;
  }
  var files = fs.readdirSync(startPath);
  for (var i = 0; i < files.length; i++) {
    var filename = path.join(startPath, files[i]);
    var stat = fs.lstatSync(filename);
    if (stat.isDirectory()) {
      registerFromDir(filename, filter, register);
    } else if (filename.endsWith(filter)) {
      register(filename);
    }
  }
}
async function copyRecursive(src, dest) {
  const entries = await async_fs.readdir(src, { withFileTypes: true });
  await async_fs.mkdir(dest, { recursive: true });
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(srcPath, destPath);
    } else {
      await async_fs.copyFile(srcPath, destPath);
    }
  }
}
const getRandomString = () => {
  return (Math.random() + 1).toString(36).substring(7);
};
function refreshAvailableModels() {
  if (ExtensionStoragePath === void 0) throw new Error("ExtensionStoragePath not defined :/");
  Object.keys(AvailableModels).forEach((key) => delete AvailableModels[key]);
  const registerModel = function(filename) {
    const dir_name = filename.split("/").at(-2);
    const name_parts = dir_name.split(".");
    const model_dir = name_parts.at(1);
    const model_name = name_parts.slice(2).join(".");
    const model_user_name = `${model_dir}/${model_name}`;
    AvailableModels[model_user_name] = filename;
    console.log(`found ${model_user_name}`);
  };
  registerFromDir(ExtensionStoragePath + "/../redhat.ai-lab/models", ".gguf", registerModel);
}
async function hasApirContainerRunning() {
  const containerInfo = (await extensionApi.containerEngine.listContainers()).find((containerInfo2) => containerInfo2.Labels["llama-cpp.apir"] === "true" && containerInfo2.State === "running");
  return containerInfo?.Id;
}
async function launchApirInferenceServer() {
  const containerId = await hasApirContainerRunning();
  if (containerId !== void 0) {
    console.error("API Remoting container ${containerId} already running ...");
    await extensionApi__namespace.window.showErrorMessage(`API Remoting container ${containerId} is already running. This version cannot have two API Remoting containers running simultaneously.`);
    return;
  }
  const status = await checkPodmanMachineStatus(false);
  if (status !== 0) {
    const msg = `Podman Machine not running with API remoting, cannot launch the API Remoting container: status #${status}.`;
    console.warn(msg);
    await extensionApi__namespace.window.showErrorMessage(msg);
    return;
  }
  if (RamalamaRemotingImage === void 0) throw new Error("Ramalama Remoting image name not loaded. This is unexpected.");
  if (Object.keys(AvailableModels).length === 0) {
    await extensionApi__namespace.window.showErrorMessage("The list of models is empty. Please download models with Podman Desktop AI lab first.");
    return;
  }
  let model_name;
  {
    refreshAvailableModels();
    model_name = await extensionApi__namespace.window.showQuickPick(Object.keys(AvailableModels), {
      canPickMany: false,
      // user can select more than one choice
      title: "Choose the model to deploy"
    });
    if (model_name === void 0) {
      console.warn("No model chosen, nothing to launch.");
      return;
    }
  }
  let host_port = await extensionApi__namespace.window.showInputBox({ title: "Service port", prompt: "Inference service port on the host", value: "1234", validateInput: (value) => parseInt(value, 10) > 1024 ? "" : "Enter a valid port > 1024" });
  host_port = parseInt(host_port);
  if (host_port === void 0 || Number.isNaN(host_port)) {
    console.warn("No host port chosen, nothing to launch.");
    return;
  }
  const imageInfo = await pullImage(
    RamalamaRemotingImage);
  const model_src = AvailableModels[model_name];
  if (model_src === void 0)
    throw new Error(`Couldn't get the file associated with model ${model_src}. This is unexpected.`);
  const model_filename = path.basename(model_src);
  const model_dirname = path.basename(path.dirname(model_src));
  const model_dest = `/models/${model_filename}`;
  const ai_lab_port = 10434;
  const labels = {
    ["ai-lab-inference-server"]: JSON.stringify([model_dirname]),
    ["api"]: `http://localhost:${host_port}/v1`,
    ["docs"]: `http://localhost:${ai_lab_port}/api-docs/${host_port}`,
    ["gpu"]: `llama.cpp API Remoting`,
    ["trackingId"]: getRandomString(),
    ["llama-cpp.apir"]: "true"
  };
  const mounts = [
    {
      Target: model_dest,
      Source: model_src,
      Type: "bind"
    }
  ];
  let entrypoint = void 0;
  let cmd = [];
  entrypoint = "/usr/bin/llama-server.sh";
  const envs = [`MODEL_PATH=${model_dest}`, "HOST=0.0.0.0", "PORT=8000", "GPU_LAYERS=999"];
  const devices = [];
  devices.push({
    PathOnHost: "/dev/dri",
    PathInContainer: "/dev/dri",
    CgroupPermissions: ""
  });
  const deviceRequests = [];
  deviceRequests.push({
    Capabilities: [["gpu"]],
    Count: -1
    // -1: all
  });
  const containerCreateOptions = {
    Image: imageInfo.Id,
    Detach: true,
    Entrypoint: entrypoint,
    Cmd: cmd,
    ExposedPorts: { [`${host_port}`]: {} },
    HostConfig: {
      AutoRemove: false,
      Devices: devices,
      Mounts: mounts,
      DeviceRequests: deviceRequests,
      SecurityOpt: ["label=disable"],
      PortBindings: {
        "8000/tcp": [
          {
            HostPort: `${host_port}`
          }
        ]
      }
    },
    HealthCheck: {
      // must be the port INSIDE the container not the exposed one
      Test: ["CMD-SHELL", `curl -sSf localhost:8000 > /dev/null`],
      Interval: SECOND * 5,
      Retries: 4 * 5
    },
    Labels: labels,
    Env: envs
  };
  console.log(containerCreateOptions, mounts);
  const { engineId, id } = await createContainer(imageInfo.engineId, containerCreateOptions);
  await extensionApi__namespace.window.showInformationMessage(`API Remoting container ${id} has been launched!`);
}
async function createContainer(engineId, containerCreateOptions, labels) {
  console.log("Creating container ...");
  try {
    const result = await extensionApi.containerEngine.createContainer(engineId, containerCreateOptions);
    console.log("Container created!");
    return {
      id: result.id,
      engineId
    };
  } catch (err2) {
    const msg = `Container creation failed :/ ${String(err2)}`;
    console.error(msg);
    await extensionApi__namespace.window.showErrorMessage(msg);
    throw err2;
  }
}
async function pullImage(image, labels) {
  console.log(`Pulling the image ${image} ...`);
  const providers = extensionApi.provider.getContainerConnections();
  const podmanProvider = providers.filter(({ connection: connection2 }) => connection2.type === "podman");
  if (!podmanProvider) throw new Error(`cannot find podman provider`);
  let connection = podmanProvider[0].connection;
  return getImageInfo(connection, image, (_event) => {
  }).catch((err2) => {
    console.error(`Something went wrong while pulling ${image}: ${String(err2)}`);
    throw err2;
  }).then((imageInfo) => {
    console.log("Image pulled successfully");
    return imageInfo;
  });
}
async function getImageInfo(connection, image, callback) {
  let imageInfo = void 0;
  try {
    await extensionApi.containerEngine.pullImage(connection, image, callback);
    imageInfo = (await extensionApi.containerEngine.listImages({
      provider: connection
    })).find((imageInfo2) => imageInfo2.RepoTags?.some((tag) => tag === image));
  } catch (err2) {
    console.warn("Something went wrong while trying to get image inspect", err2);
    await extensionApi__namespace.window.showErrorMessage(`Something went wrong while trying to get image inspect: ${err2}`);
    throw err2;
  }
  if (imageInfo === void 0) throw new Error(`image ${image} not found.`);
  return imageInfo;
}
async function initializeBuildDir(buildPath) {
  console.log(`Initializing the build directory from ${buildPath} ...`);
  ApirVersion = (await async_fs.readFile(buildPath + "/src_info/version.txt", "utf8")).replace(/\n$/, "");
  if (RamalamaRemotingImage === void 0)
    RamalamaRemotingImage = (await async_fs.readFile(buildPath + "/src_info/ramalama.image-info.txt", "utf8")).replace(/\n$/, "");
}
async function initializeStorageDir(storagePath, buildPath) {
  console.log(`Initializing the storage directory ...`);
  if (!fs.existsSync(storagePath)) {
    fs.mkdirSync(storagePath);
  }
  if (ApirVersion === void 0) throw new Error("APIR version not loaded. This is unexpected.");
  LocalBuildDir = `${storagePath}/${ApirVersion}`;
  if (!fs.existsSync(LocalBuildDir)) {
    copyRecursive(buildPath, LocalBuildDir).then(() => console.log("Copy complete"));
  }
}
async function activate(extensionContext) {
  ExtensionStoragePath = extensionContext.storagePath;
  console.log("Activating the API Remoting extension ...");
  try {
    await initializeBuildDir(EXTENSION_BUILD_PATH);
    console.log(`Installing APIR version ${ApirVersion} ...`);
    console.log(`Using image ${RamalamaRemotingImage}`);
    await initializeStorageDir(extensionContext.storagePath, EXTENSION_BUILD_PATH);
    console.log(`Preparing the krunkit binaries ...`);
    await prepare_krunkit();
    console.log(`Loading the models ...`);
    refreshAvailableModels();
  } catch (error) {
    const msg = `Couldn't initialize the extension: ${error}`;
    await extensionApi__namespace.window.showErrorMessage(msg);
  }
  const menuCommand = extensionApi__namespace.commands.registerCommand("llama.cpp.apir.menu", async () => {
    if (!extensionApi__namespace.env.isMac) {
      await extensionApi__namespace.window.showErrorMessage(`llama.cpp API Remoting only supported on MacOS.`);
      return;
    }
    let result;
    {
      result = await extensionApi__namespace.window.showQuickPick(Object.keys(MAIN_MENU_CHOICES), {
        title: "What do you want to do?",
        canPickMany: false
        // user can select more than one choice
      });
    }
    if (result === void 0) {
      console.log("No user choice, aborting.");
      return;
    }
    try {
      MAIN_MENU_CHOICES[result]();
    } catch (error) {
      const msg = `Task failed: ${String(error)}`;
      console.error(msg);
      await extensionApi__namespace.window.showErrorMessage(msg);
      throw err;
    }
  });
  try {
    const item = extensionApi__namespace.window.createStatusBarItem(extensionApi__namespace.StatusBarAlignLeft, 100);
    item.text = "Llama.cpp API Remoting";
    item.command = "llama.cpp.apir.menu";
    item.show();
    extensionContext.subscriptions.push(menuCommand);
    extensionContext.subscriptions.push(item);
  } catch (error) {
    const msg = `Couldn't subscribe the extension to Podman Desktop: ${error}`;
    await extensionApi__namespace.window.showErrorMessage(msg);
    throw new Error(msg);
  }
}
async function deactivate() {
}
async function restart_podman_machine_with_apir() {
  if (LocalBuildDir === void 0) throw new Error("LocalBuildDir not loaded. This is unexpected.");
  await extensionApi__namespace.window.showInformationMessage(`Restarting Podman machine with APIR support ...`);
  try {
    const { stdout } = await extensionApi__namespace.process.exec("/usr/bin/env", ["bash", `${LocalBuildDir}/podman_start_machine.api_remoting.sh`], { cwd: LocalBuildDir });
    const msg = "Podman machine successfully restarted with the APIR libraries";
    await extensionApi__namespace.window.showInformationMessage(msg);
    console.log(msg);
  } catch (error) {
    const msg = `Failed to restart podman machine with the API libraries: ${error}`;
    await extensionApi__namespace.window.showErrorMessage(msg);
    console.error(msg);
    throw new Error(msg);
  }
}
async function restart_podman_machine_without_apir() {
  await extensionApi__namespace.window.showInformationMessage(`Restarting Podman machine without API Remoting support`);
  try {
    console.log(`Stopping the PodMan Machine ...`);
    const { stdout } = await extensionApi__namespace.process.exec("podman", ["machine", "stop"]);
  } catch (error) {
    const msg2 = `Failed to stop the PodMan Machine: ${error}`;
    await extensionApi__namespace.window.showErrorMessage(msg2);
    console.error(msg2);
    throw new Error(msg2);
  }
  try {
    console.log(`Starting the PodMan Machine ...`);
    const { stdout } = await extensionApi__namespace.process.exec("podman", ["machine", "start"]);
  } catch (error) {
    const msg2 = `Failed to restart the PodMan Machine: ${error}`;
    await extensionApi__namespace.window.showErrorMessage(msg2);
    console.error(msg2);
    throw new Error(msg2);
  }
  const msg = "PodMan Machine successfully restarted without API Remoting support";
  await extensionApi__namespace.window.showInformationMessage(msg);
  console.error(msg);
}
async function prepare_krunkit() {
  if (LocalBuildDir === void 0) throw new Error("LocalBuildDir not loaded. This is unexpected.");
  if (fs.existsSync(`${LocalBuildDir}/bin/krunkit`)) {
    console.log("Binaries already prepared.");
    return;
  }
  await extensionApi__namespace.window.showInformationMessage(`Preparing the krunkit binaries for API Remoting ...`);
  try {
    const { stdout } = await extensionApi__namespace.process.exec("/usr/bin/env", ["bash", `${LocalBuildDir}/update_krunkit.sh`], { cwd: LocalBuildDir });
  } catch (error) {
    console.error(error);
    throw new Error(`Couldn't update the krunkit binaries: ${error}: ${error.stdout}`);
  }
  await extensionApi__namespace.window.showInformationMessage(`Binaries successfully prepared!`);
  console.log("Binaries successfully prepared!");
}
async function checkPodmanMachineStatus(with_gui) {
  try {
    const { stdout } = await extensionApi__namespace.process.exec("/usr/bin/env", ["bash", `${EXTENSION_BUILD_PATH}/check_podman_machine_status.sh`], { cwd: LocalBuildDir });
    const status = stdout.replace(/\n$/, "");
    const msg = `Podman Machine API Remoting status:
${status}`;
    if (with_gui) {
      await extensionApi__namespace.window.showInformationMessage(msg);
    }
    console.log(msg);
    return 0;
  } catch (error) {
    let msg;
    const status = error.stdout.replace(/\n$/, "");
    const exitCode = error.exitCode;
    if (exitCode > 10 && exitCode < 20) {
      msg = `Podman Machine status: ${status}: status #${exitCode}`;
      if (with_gui) {
        await extensionApi__namespace.window.showErrorMessage(msg);
      }
      console.warn(msg);
      return exitCode;
    }
    msg = `Failed to check PodMan Machine status: ${status} (code #${exitCode})`;
    await extensionApi__namespace.window.showErrorMessage(msg);
    console.error(msg);
    throw new Error(msg);
  }
}

exports.SECOND = SECOND;
exports.activate = activate;
exports.deactivate = deactivate;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXh0ZW5zaW9uLmpzIiwic291cmNlcyI6WyIuLi9zcmMvZXh0ZW5zaW9uLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHtcbiAgICBDb250YWluZXJDcmVhdGVPcHRpb25zLFxuICAgIENvbnRhaW5lclByb3ZpZGVyQ29ubmVjdGlvbixcbiAgICBEZXZpY2VSZXF1ZXN0LFxuICAgIEltYWdlSW5mbyxcbiAgICBNb3VudENvbmZpZyxcbiAgICBQcm92aWRlckNvbnRhaW5lckNvbm5lY3Rpb24sXG59IGZyb20gJ0Bwb2RtYW4tZGVza3RvcC9hcGknO1xuXG5pbXBvcnQgKiBhcyBleHRlbnNpb25BcGkgZnJvbSAnQHBvZG1hbi1kZXNrdG9wL2FwaSc7XG5pbXBvcnQgdHlwZSB7IFBvZG1hbkNvbm5lY3Rpb24gfSBmcm9tICcuLi8uLi9tYW5hZ2Vycy9wb2RtYW5Db25uZWN0aW9uJztcbmltcG9ydCAqIGFzIFBvZG1hbkNvbm5lY3Rpb25BUEkgZnJvbSAnLi4vLi4vbWFuYWdlcnMvcG9kbWFuQ29ubmVjdGlvbic7XG5pbXBvcnQgeyBjb250YWluZXJFbmdpbmUsIHByb3ZpZGVyLCBQcm9ncmVzc0xvY2F0aW9uIH0gZnJvbSAnQHBvZG1hbi1kZXNrdG9wL2FwaSc7XG5cbmV4cG9ydCBjb25zdCBTRUNPTkQ6IG51bWJlciA9IDFfMDAwXzAwMF8wMDA7XG5cbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XG5jb25zdCBhc3luY19mcyA9IHJlcXVpcmUoJ2ZzL3Byb21pc2VzJyk7XG5cbmNvbnN0IEF2YWlsYWJsZU1vZGVscyA9IHt9O1xubGV0IEV4dGVuc2lvblN0b3JhZ2VQYXRoID0gdW5kZWZpbmVkO1xuXG5jb25zdCBGQUlMX0lGX05PVF9NQUMgPSB0cnVlO1xuY29uc3QgU0hPV19JTklUSUFMX01FTlUgPSB0cnVlO1xuY29uc3QgU0hPV19NT0RFTF9TRUxFQ1RfTUVOVSA9IHRydWU7XG5jb25zdCBFWFRFTlNJT05fQlVJTERfUEFUSCA9IHBhdGgucGFyc2UoX19maWxlbmFtZSkuZGlyICsgXCIvLi4vYnVpbGRcIjtcblxuY29uc3QgREVGQVVMVF9NT0RFTF9OQU1FID0gXCJpYm0tZ3Jhbml0ZS9ncmFuaXRlLTMuMy04Yi1pbnN0cnVjdC1HR1VGXCI7IC8vIGlmIG5vdCBzaG93aW5nIHRoZSBzZWxlY3QgbWVudVxubGV0IFJhbWFsYW1hUmVtb3RpbmdJbWFnZSA9IHVuZGVmaW5lZDtcbmxldCBBcGlyVmVyc2lvbiA9IHVuZGVmaW5lZDtcbmxldCBMb2NhbEJ1aWxkRGlyID0gdW5kZWZpbmVkO1xuXG5jb25zdCBNQUlOX01FTlVfQ0hPSUNFUyA9IHtcbiAgICAnUmVzdGFydCBQb2RNYW4gTWFjaGluZSB3aXRoIEFQSSBSZW1vdGluZyBzdXBwb3J0JzogKCkgPT4gcmVzdGFydF9wb2RtYW5fbWFjaGluZV93aXRoX2FwaXIoKSxcbiAgICAnUmVzdGFydCBQb2RNYW4gTWFjaGluZSB3aXRoIHRoZSBkZWZhdWx0IGNvbmZpZ3VyYXRpb24nOiAoKSA9PiByZXN0YXJ0X3BvZG1hbl9tYWNoaW5lX3dpdGhvdXRfYXBpcigpLFxuICAgICdMYXVuY2ggYW4gQVBJIFJlbW90aW5nIGFjY2VsZXJhdGVkIEluZmVyZW5jZSBTZXJ2ZXInOiAoKSA9PiBsYXVuY2hBcGlySW5mZXJlbmNlU2VydmVyKCksXG4gICAgJ0NoZWNrICBQb2RNYW4gTWFjaGluZSBBUEkgUmVtb3Rpbmcgc3RhdHVzJzogKCkgPT4gY2hlY2tQb2RtYW5NYWNoaW5lU3RhdHVzKHRydWUpLFxufVxuXG5mdW5jdGlvbiByZWdpc3RlckZyb21EaXIoc3RhcnRQYXRoLCBmaWx0ZXIsIHJlZ2lzdGVyKSB7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKHN0YXJ0UGF0aCkpIHtcbiAgICAgICAgY29uc29sZS5sb2coXCJubyBkaXIgXCIsIHN0YXJ0UGF0aCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgZmlsZXMgPSBmcy5yZWFkZGlyU3luYyhzdGFydFBhdGgpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmlsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIGZpbGVuYW1lID0gcGF0aC5qb2luKHN0YXJ0UGF0aCwgZmlsZXNbaV0pO1xuICAgICAgICB2YXIgc3RhdCA9IGZzLmxzdGF0U3luYyhmaWxlbmFtZSk7XG4gICAgICAgIGlmIChzdGF0LmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIHJlZ2lzdGVyRnJvbURpcihmaWxlbmFtZSwgZmlsdGVyLCByZWdpc3Rlcik7IC8vcmVjdXJzZVxuICAgICAgICB9IGVsc2UgaWYgKGZpbGVuYW1lLmVuZHNXaXRoKGZpbHRlcikpIHtcbiAgICAgICAgICAgIHJlZ2lzdGVyKGZpbGVuYW1lKTtcbiAgICAgICAgfTtcbiAgICB9O1xufTtcblxuLy8gZ2VuZXJhdGVkIGJ5IGNoYXRncHRcbmFzeW5jIGZ1bmN0aW9uIGNvcHlSZWN1cnNpdmUoc3JjLCBkZXN0KSB7XG4gIGNvbnN0IGVudHJpZXMgPSBhd2FpdCBhc3luY19mcy5yZWFkZGlyKHNyYywgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuXG4gIGF3YWl0IGFzeW5jX2ZzLm1rZGlyKGRlc3QsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuXG4gIGZvciAobGV0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBjb25zdCBzcmNQYXRoID0gcGF0aC5qb2luKHNyYywgZW50cnkubmFtZSk7XG4gICAgY29uc3QgZGVzdFBhdGggPSBwYXRoLmpvaW4oZGVzdCwgZW50cnkubmFtZSk7XG5cbiAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgYXdhaXQgY29weVJlY3Vyc2l2ZShzcmNQYXRoLCBkZXN0UGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IGFzeW5jX2ZzLmNvcHlGaWxlKHNyY1BhdGgsIGRlc3RQYXRoKTtcbiAgICB9XG4gIH1cbn1cblxuY29uc3QgZ2V0UmFuZG9tU3RyaW5nID0gKCk6IHN0cmluZyA9PiB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBzb25hcmpzL3BzZXVkby1yYW5kb21cbiAgcmV0dXJuIChNYXRoLnJhbmRvbSgpICsgMSkudG9TdHJpbmcoMzYpLnN1YnN0cmluZyg3KTtcbn07XG5cbmZ1bmN0aW9uIHJlZnJlc2hBdmFpbGFibGVNb2RlbHMoKSB7XG4gICAgaWYgKEV4dGVuc2lvblN0b3JhZ2VQYXRoID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcignRXh0ZW5zaW9uU3RvcmFnZVBhdGggbm90IGRlZmluZWQgOi8nKTtcblxuICAgIC8vIGRlbGV0ZSB0aGUgZXhpc3RpbmcgbW9kZWxzXG4gICAgT2JqZWN0LmtleXMoQXZhaWxhYmxlTW9kZWxzKS5mb3JFYWNoKGtleSA9PiBkZWxldGUgQXZhaWxhYmxlTW9kZWxzW2tleV0pO1xuXG4gICAgY29uc3QgcmVnaXN0ZXJNb2RlbCA9IGZ1bmN0aW9uKGZpbGVuYW1lKSB7XG4gICAgICAgIGNvbnN0IGRpcl9uYW1lID0gZmlsZW5hbWUuc3BsaXQoXCIvXCIpLmF0KC0yKVxuICAgICAgICBjb25zdCBuYW1lX3BhcnRzID0gZGlyX25hbWUuc3BsaXQoXCIuXCIpXG4gICAgICAgIC8vIDAgaXMgdGhlIHNvdXJjZSAoZWcsIGhmKVxuICAgICAgICBjb25zdCBtb2RlbF9kaXIgPSBuYW1lX3BhcnRzLmF0KDEpXG4gICAgICAgIGNvbnN0IG1vZGVsX25hbWUgPSBuYW1lX3BhcnRzLnNsaWNlKDIpLmpvaW4oJy4nKVxuICAgICAgICBjb25zdCBtb2RlbF91c2VyX25hbWUgPSBgJHttb2RlbF9kaXJ9LyR7bW9kZWxfbmFtZX1gXG4gICAgICAgIEF2YWlsYWJsZU1vZGVsc1ttb2RlbF91c2VyX25hbWVdID0gZmlsZW5hbWU7XG4gICAgICAgIGNvbnNvbGUubG9nKGBmb3VuZCAke21vZGVsX3VzZXJfbmFtZX1gKVxuICAgIH1cblxuICAgIHJlZ2lzdGVyRnJvbURpcihFeHRlbnNpb25TdG9yYWdlUGF0aCArICcvLi4vcmVkaGF0LmFpLWxhYi9tb2RlbHMnLCAnLmdndWYnLCByZWdpc3Rlck1vZGVsKTtcbn1cblxuZnVuY3Rpb24gc2xlZXAobXMpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCBtcykpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBoYXNBcGlyQ29udGFpbmVyUnVubmluZygpIHtcbiAgICBjb25zdCBjb250YWluZXJJbmZvID1cbiAgICAgICAgICAoYXdhaXQgY29udGFpbmVyRW5naW5lLmxpc3RDb250YWluZXJzKCkpXG4gICAgICAgICAgLmZpbmQoY29udGFpbmVySW5mbyA9PiAoY29udGFpbmVySW5mby5MYWJlbHNbXCJsbGFtYS1jcHAuYXBpclwiXSA9PT0gXCJ0cnVlXCIgJiYgY29udGFpbmVySW5mby5TdGF0ZSA9PT0gXCJydW5uaW5nXCIpKTtcblxuICAgIHJldHVybiBjb250YWluZXJJbmZvPy5JZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbGF1bmNoQXBpckluZmVyZW5jZVNlcnZlcigpIHtcbiAgICBjb25zdCBjb250YWluZXJJZCA9IGF3YWl0IGhhc0FwaXJDb250YWluZXJSdW5uaW5nKCk7XG4gICAgaWYgKGNvbnRhaW5lcklkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkFQSSBSZW1vdGluZyBjb250YWluZXIgJHtjb250YWluZXJJZH0gYWxyZWFkeSBydW5uaW5nIC4uLlwiKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKGBBUEkgUmVtb3RpbmcgY29udGFpbmVyICR7Y29udGFpbmVySWR9IGlzIGFscmVhZHkgcnVubmluZy4gVGhpcyB2ZXJzaW9uIGNhbm5vdCBoYXZlIHR3byBBUEkgUmVtb3RpbmcgY29udGFpbmVycyBydW5uaW5nIHNpbXVsdGFuZW91c2x5LmApO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgc3RhdHVzID0gYXdhaXQgY2hlY2tQb2RtYW5NYWNoaW5lU3RhdHVzKGZhbHNlKTtcbiAgICBpZiAoc3RhdHVzICE9PSAwKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBQb2RtYW4gTWFjaGluZSBub3QgcnVubmluZyB3aXRoIEFQSSByZW1vdGluZywgY2Fubm90IGxhdW5jaCB0aGUgQVBJIFJlbW90aW5nIGNvbnRhaW5lcjogc3RhdHVzICMke3N0YXR1c30uYFxuICAgICAgICBjb25zb2xlLndhcm4obXNnKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoUmFtYWxhbWFSZW1vdGluZ0ltYWdlID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIlJhbWFsYW1hIFJlbW90aW5nIGltYWdlIG5hbWUgbm90IGxvYWRlZC4gVGhpcyBpcyB1bmV4cGVjdGVkLlwiKTtcblxuICAgIGlmIChPYmplY3Qua2V5cyhBdmFpbGFibGVNb2RlbHMpLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UoXCJUaGUgbGlzdCBvZiBtb2RlbHMgaXMgZW1wdHkuIFBsZWFzZSBkb3dubG9hZCBtb2RlbHMgd2l0aCBQb2RtYW4gRGVza3RvcCBBSSBsYWIgZmlyc3QuXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGxldCBtb2RlbF9uYW1lO1xuICAgIGlmIChTSE9XX01PREVMX1NFTEVDVF9NRU5VKSB7XG4gICAgICAgIHJlZnJlc2hBdmFpbGFibGVNb2RlbHMoKTtcblxuICAgICAgICAvLyBkaXNwbGF5IGEgY2hvaWNlIHRvIHRoZSB1c2VyIGZvciBzZWxlY3Rpbmcgc29tZSB2YWx1ZXNcbiAgICAgICAgbW9kZWxfbmFtZSA9IGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd1F1aWNrUGljayhPYmplY3Qua2V5cyhBdmFpbGFibGVNb2RlbHMpLCB7XG4gICAgICAgICAgICBjYW5QaWNrTWFueTogZmFsc2UsIC8vIHVzZXIgY2FuIHNlbGVjdCBtb3JlIHRoYW4gb25lIGNob2ljZVxuICAgICAgICAgICAgdGl0bGU6IFwiQ2hvb3NlIHRoZSBtb2RlbCB0byBkZXBsb3lcIixcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChtb2RlbF9uYW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybignTm8gbW9kZWwgY2hvc2VuLCBub3RoaW5nIHRvIGxhdW5jaC4nKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICB9IGVsc2Uge1xuICAgICAgICBtb2RlbF9uYW1lID0gREVGQVVMVF9NT0RFTF9OQU1FO1xuICAgIH1cblxuICAgIC8vIHByZXBhcmUgdGhlIHBvcnRcbiAgICBsZXQgaG9zdF9wb3J0ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5wdXRCb3goe3RpdGxlOiBcIlNlcnZpY2UgcG9ydFwiLCBwcm9tcHQ6IFwiSW5mZXJlbmNlIHNlcnZpY2UgcG9ydCBvbiB0aGUgaG9zdFwiLCB2YWx1ZTogXCIxMjM0XCIsIHZhbGlkYXRlSW5wdXQ6ICh2YWx1ZSk9PiBwYXJzZUludCh2YWx1ZSwgMTApID4gMTAyNCA/IFwiXCI6IFwiRW50ZXIgYSB2YWxpZCBwb3J0ID4gMTAyNFwifSk7XG4gICAgaG9zdF9wb3J0ID0gcGFyc2VJbnQoaG9zdF9wb3J0KTtcblxuICAgIGlmIChob3N0X3BvcnQgPT09IHVuZGVmaW5lZCB8fCBOdW1iZXIuaXNOYU4oaG9zdF9wb3J0KSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ05vIGhvc3QgcG9ydCBjaG9zZW4sIG5vdGhpbmcgdG8gbGF1bmNoLicpXG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBwdWxsIHRoZSBpbWFnZVxuICAgIGNvbnN0IGltYWdlSW5mbzogSW1hZ2VJbmZvID0gYXdhaXQgcHVsbEltYWdlKFxuICAgICAgICBSYW1hbGFtYVJlbW90aW5nSW1hZ2UsXG4gICAgICAgIHt9LFxuICAgICk7XG5cblxuICAgIC8vIGdldCBtb2RlbCBtb3VudCBzZXR0aW5nc1xuICAgIGNvbnN0IG1vZGVsX3NyYyA9IEF2YWlsYWJsZU1vZGVsc1ttb2RlbF9uYW1lXTtcbiAgICBpZiAobW9kZWxfc3JjID09PSB1bmRlZmluZWQpXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgZ2V0IHRoZSBmaWxlIGFzc29jaWF0ZWQgd2l0aCBtb2RlbCAke21vZGVsX3NyY30uIFRoaXMgaXMgdW5leHBlY3RlZC5gKTtcblxuICAgIGNvbnN0IG1vZGVsX2ZpbGVuYW1lID0gcGF0aC5iYXNlbmFtZShtb2RlbF9zcmMpO1xuICAgIGNvbnN0IG1vZGVsX2Rpcm5hbWUgPSBwYXRoLmJhc2VuYW1lKHBhdGguZGlybmFtZShtb2RlbF9zcmMpKTtcbiAgICBjb25zdCBtb2RlbF9kZXN0ID0gYC9tb2RlbHMvJHttb2RlbF9maWxlbmFtZX1gO1xuICAgIGNvbnN0IGFpX2xhYl9wb3J0ID0gMTA0MzQ7XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBsYWJlbHNcbiAgICBjb25zdCBsYWJlbHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICAgIFsnYWktbGFiLWluZmVyZW5jZS1zZXJ2ZXInXTogSlNPTi5zdHJpbmdpZnkoW21vZGVsX2Rpcm5hbWVdKSxcbiAgICAgICAgWydhcGknXTogYGh0dHA6Ly9sb2NhbGhvc3Q6JHtob3N0X3BvcnR9L3YxYCxcbiAgICAgICAgWydkb2NzJ106IGBodHRwOi8vbG9jYWxob3N0OiR7YWlfbGFiX3BvcnR9L2FwaS1kb2NzLyR7aG9zdF9wb3J0fWAsXG4gICAgICAgIFsnZ3B1J106IGBsbGFtYS5jcHAgQVBJIFJlbW90aW5nYCxcbiAgICAgICAgW1widHJhY2tpbmdJZFwiXTogZ2V0UmFuZG9tU3RyaW5nKCksXG4gICAgICAgIFtcImxsYW1hLWNwcC5hcGlyXCJdOiBcInRydWVcIixcbiAgICB9O1xuXG4gICAgLy8gcHJlcGFyZSB0aGUgbW91bnRzXG4gICAgLy8gbW91bnQgdGhlIGZpbGUgZGlyZWN0b3J5IHRvIGF2b2lkIGFkZGluZyBvdGhlciBmaWxlcyB0byB0aGUgY29udGFpbmVyc1xuICAgIGNvbnN0IG1vdW50czogTW91bnRDb25maWcgPSBbXG4gICAgICB7XG4gICAgICAgICAgVGFyZ2V0OiBtb2RlbF9kZXN0LFxuICAgICAgICAgIFNvdXJjZTogbW9kZWxfc3JjLFxuICAgICAgICAgIFR5cGU6ICdiaW5kJyxcbiAgICAgIH0sXG4gICAgXTtcblxuICAgIC8vIHByZXBhcmUgdGhlIGVudHJ5cG9pbnRcbiAgICBsZXQgZW50cnlwb2ludDogc3RyaW5nIHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xuICAgIGxldCBjbWQ6IHN0cmluZ1tdID0gW107XG5cbiAgICBlbnRyeXBvaW50ID0gXCIvdXNyL2Jpbi9sbGFtYS1zZXJ2ZXIuc2hcIjtcblxuICAgIC8vIHByZXBhcmUgdGhlIGVudlxuICAgIGNvbnN0IGVudnM6IHN0cmluZ1tdID0gW2BNT0RFTF9QQVRIPSR7bW9kZWxfZGVzdH1gLCAnSE9TVD0wLjAuMC4wJywgJ1BPUlQ9ODAwMCcsICdHUFVfTEFZRVJTPTk5OSddO1xuXG4gICAgLy8gcHJlcGFyZSB0aGUgZGV2aWNlc1xuICAgIGNvbnN0IGRldmljZXM6IERldmljZVtdID0gW107XG4gICAgZGV2aWNlcy5wdXNoKHtcbiAgICAgICAgUGF0aE9uSG9zdDogJy9kZXYvZHJpJyxcbiAgICAgICAgUGF0aEluQ29udGFpbmVyOiAnL2Rldi9kcmknLFxuICAgICAgICBDZ3JvdXBQZXJtaXNzaW9uczogJycsXG4gICAgfSk7XG5cbiAgICBjb25zdCBkZXZpY2VSZXF1ZXN0czogRGV2aWNlUmVxdWVzdFtdID0gW107XG4gICAgZGV2aWNlUmVxdWVzdHMucHVzaCh7XG4gICAgICAgIENhcGFiaWxpdGllczogW1snZ3B1J11dLFxuICAgICAgICBDb3VudDogLTEsIC8vIC0xOiBhbGxcbiAgICB9KTtcblxuICAgIC8vIEdldCB0aGUgY29udGFpbmVyIGNyZWF0aW9uIG9wdGlvbnNcbiAgICBjb25zdCBjb250YWluZXJDcmVhdGVPcHRpb25zOiBDb250YWluZXJDcmVhdGVPcHRpb25zID0ge1xuICAgICAgICBJbWFnZTogaW1hZ2VJbmZvLklkLFxuICAgICAgICBEZXRhY2g6IHRydWUsXG4gICAgICAgIEVudHJ5cG9pbnQ6IGVudHJ5cG9pbnQsXG4gICAgICAgIENtZDogY21kLFxuICAgICAgICBFeHBvc2VkUG9ydHM6IHsgW2Ake2hvc3RfcG9ydH1gXToge30gfSxcbiAgICAgICAgSG9zdENvbmZpZzoge1xuICAgICAgICAgICAgQXV0b1JlbW92ZTogZmFsc2UsXG4gICAgICAgICAgICBEZXZpY2VzOiBkZXZpY2VzLFxuICAgICAgICAgICAgTW91bnRzOiBtb3VudHMsXG4gICAgICAgICAgICBEZXZpY2VSZXF1ZXN0czogZGV2aWNlUmVxdWVzdHMsXG4gICAgICAgICAgICBTZWN1cml0eU9wdDogW1wibGFiZWw9ZGlzYWJsZVwiXSxcbiAgICAgICAgICAgIFBvcnRCaW5kaW5nczoge1xuICAgICAgICAgICAgICAgICc4MDAwL3RjcCc6IFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgSG9zdFBvcnQ6IGAke2hvc3RfcG9ydH1gLFxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB9LFxuICAgICAgICB9LFxuXG4gICAgICAgIEhlYWx0aENoZWNrOiB7XG4gICAgICAgICAgLy8gbXVzdCBiZSB0aGUgcG9ydCBJTlNJREUgdGhlIGNvbnRhaW5lciBub3QgdGhlIGV4cG9zZWQgb25lXG4gICAgICAgICAgVGVzdDogWydDTUQtU0hFTEwnLCBgY3VybCAtc1NmIGxvY2FsaG9zdDo4MDAwID4gL2Rldi9udWxsYF0sXG4gICAgICAgICAgSW50ZXJ2YWw6IFNFQ09ORCAqIDUsXG4gICAgICAgICAgUmV0cmllczogNCAqIDUsXG4gICAgICAgICAgfSxcbiAgICAgICAgTGFiZWxzOiBsYWJlbHMsXG4gICAgICAgIEVudjogZW52cyxcbiAgICB9O1xuICAgIGNvbnNvbGUubG9nKGNvbnRhaW5lckNyZWF0ZU9wdGlvbnMsIG1vdW50cylcbiAgICAvLyBDcmVhdGUgdGhlIGNvbnRhaW5lclxuICAgIGNvbnN0IHsgZW5naW5lSWQsIGlkIH0gPSBhd2FpdCBjcmVhdGVDb250YWluZXIoaW1hZ2VJbmZvLmVuZ2luZUlkLCBjb250YWluZXJDcmVhdGVPcHRpb25zLCBsYWJlbHMpO1xuXG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKGBBUEkgUmVtb3RpbmcgY29udGFpbmVyICR7aWR9IGhhcyBiZWVuIGxhdW5jaGVkIWApO1xuXG59XG5leHBvcnQgdHlwZSBCZXR0ZXJDb250YWluZXJDcmVhdGVSZXN1bHQgPSBDb250YWluZXJDcmVhdGVSZXN1bHQgJiB7IGVuZ2luZUlkOiBzdHJpbmcgfTtcblxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlQ29udGFpbmVyKFxuICAgIGVuZ2luZUlkOiBzdHJpbmcsXG4gICAgY29udGFpbmVyQ3JlYXRlT3B0aW9uczogQ29udGFpbmVyQ3JlYXRlT3B0aW9ucyxcbiAgICBsYWJlbHM6IHsgW2lkOiBzdHJpbmddOiBzdHJpbmcgfSxcbik6IFByb21pc2U8QmV0dGVyQ29udGFpbmVyQ3JlYXRlUmVzdWx0PiB7XG5cbiAgICBjb25zb2xlLmxvZyhcIkNyZWF0aW5nIGNvbnRhaW5lciAuLi5cIik7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgY29udGFpbmVyRW5naW5lLmNyZWF0ZUNvbnRhaW5lcihlbmdpbmVJZCwgY29udGFpbmVyQ3JlYXRlT3B0aW9ucyk7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiQ29udGFpbmVyIGNyZWF0ZWQhXCIpO1xuXG4gICAgICAgIC8vIHJldHVybiB0aGUgQ29udGFpbmVyQ3JlYXRlUmVzdWx0XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBpZDogcmVzdWx0LmlkLFxuICAgICAgICAgICAgZW5naW5lSWQ6IGVuZ2luZUlkLFxuICAgICAgICB9O1xuICAgIH0gY2F0Y2ggKGVycjogdW5rbm93bikge1xuICAgICAgICBjb25zdCBtc2cgPSBgQ29udGFpbmVyIGNyZWF0aW9uIGZhaWxlZCA6LyAke1N0cmluZyhlcnIpfWBcbiAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgdGhyb3cgZXJyO1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcHVsbEltYWdlKFxuICAgIGltYWdlOiBzdHJpbmcsXG4gICAgbGFiZWxzOiB7IFtpZDogc3RyaW5nXTogc3RyaW5nIH0sXG4pOiBQcm9taXNlPEltYWdlSW5mbz4ge1xuICAgIC8vIENyZWF0aW5nIGEgdGFzayB0byBmb2xsb3cgcHVsbGluZyBwcm9ncmVzc1xuICAgIGNvbnNvbGUubG9nKGBQdWxsaW5nIHRoZSBpbWFnZSAke2ltYWdlfSAuLi5gKVxuXG4gICAgY29uc3QgcHJvdmlkZXJzOiBQcm92aWRlckNvbnRhaW5lckNvbm5lY3Rpb25bXSA9IHByb3ZpZGVyLmdldENvbnRhaW5lckNvbm5lY3Rpb25zKCk7XG4gICAgY29uc3QgcG9kbWFuUHJvdmlkZXIgPSBwcm92aWRlcnNcbiAgICAgICAgICAuZmlsdGVyKCh7IGNvbm5lY3Rpb24gfSkgPT4gY29ubmVjdGlvbi50eXBlID09PSAncG9kbWFuJyk7XG4gICAgaWYgKCFwb2RtYW5Qcm92aWRlcikgdGhyb3cgbmV3IEVycm9yKGBjYW5ub3QgZmluZCBwb2RtYW4gcHJvdmlkZXJgKTtcblxuICAgIGxldCBjb25uZWN0aW9uOiBDb250YWluZXJQcm92aWRlckNvbm5lY3Rpb24gPSBwb2RtYW5Qcm92aWRlclswXS5jb25uZWN0aW9uO1xuXG4gICAgLy8gZ2V0IHRoZSBkZWZhdWx0IGltYWdlIGluZm8gZm9yIHRoaXMgcHJvdmlkZXJcbiAgICByZXR1cm4gZ2V0SW1hZ2VJbmZvKGNvbm5lY3Rpb24sIGltYWdlLCAoX2V2ZW50OiBQdWxsRXZlbnQpID0+IHt9KVxuICAgICAgICAuY2F0Y2goKGVycjogdW5rbm93bikgPT4ge1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgU29tZXRoaW5nIHdlbnQgd3Jvbmcgd2hpbGUgcHVsbGluZyAke2ltYWdlfTogJHtTdHJpbmcoZXJyKX1gKTtcbiAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfSlcbiAgICAgICAgLnRoZW4oaW1hZ2VJbmZvID0+IHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiSW1hZ2UgcHVsbGVkIHN1Y2Nlc3NmdWxseVwiKTtcbiAgICAgICAgICAgIHJldHVybiBpbWFnZUluZm87XG4gICAgICAgIH0pO1xufVxuXG5hc3luYyBmdW5jdGlvbiBnZXRJbWFnZUluZm8oXG4gIGNvbm5lY3Rpb246IENvbnRhaW5lclByb3ZpZGVyQ29ubmVjdGlvbixcbiAgaW1hZ2U6IHN0cmluZyxcbiAgY2FsbGJhY2s6IChldmVudDogUHVsbEV2ZW50KSA9PiB2b2lkLFxuKTogUHJvbWlzZTxJbWFnZUluZm8+IHtcbiAgICBsZXQgaW1hZ2VJbmZvID0gdW5kZWZpbmVkO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgLy8gUHVsbCBpbWFnZVxuICAgICAgICBhd2FpdCBjb250YWluZXJFbmdpbmUucHVsbEltYWdlKGNvbm5lY3Rpb24sIGltYWdlLCBjYWxsYmFjayk7XG5cbiAgICAgICAgLy8gR2V0IGltYWdlIGluc3BlY3RcbiAgICAgICAgaW1hZ2VJbmZvID0gKFxuICAgICAgICAgICAgYXdhaXQgY29udGFpbmVyRW5naW5lLmxpc3RJbWFnZXMoe1xuICAgICAgICAgICAgICAgIHByb3ZpZGVyOiBjb25uZWN0aW9uLFxuICAgICAgICAgICAgfSBhcyBMaXN0SW1hZ2VzT3B0aW9ucylcbiAgICAgICAgKS5maW5kKGltYWdlSW5mbyA9PiBpbWFnZUluZm8uUmVwb1RhZ3M/LnNvbWUodGFnID0+IHRhZyA9PT0gaW1hZ2UpKTtcblxuICAgIH0gY2F0Y2ggKGVycjogdW5rbm93bikge1xuICAgICAgICBjb25zb2xlLndhcm4oJ1NvbWV0aGluZyB3ZW50IHdyb25nIHdoaWxlIHRyeWluZyB0byBnZXQgaW1hZ2UgaW5zcGVjdCcsIGVycik7XG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShgU29tZXRoaW5nIHdlbnQgd3Jvbmcgd2hpbGUgdHJ5aW5nIHRvIGdldCBpbWFnZSBpbnNwZWN0OiAke2Vycn1gKTtcblxuICAgICAgICB0aHJvdyBlcnI7XG4gICAgfVxuXG4gICAgaWYgKGltYWdlSW5mbyA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYGltYWdlICR7aW1hZ2V9IG5vdCBmb3VuZC5gKTtcblxuICAgIHJldHVybiBpbWFnZUluZm87XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGluaXRpYWxpemVCdWlsZERpcihidWlsZFBhdGgpIHtcbiAgICBjb25zb2xlLmxvZyhgSW5pdGlhbGl6aW5nIHRoZSBidWlsZCBkaXJlY3RvcnkgZnJvbSAke2J1aWxkUGF0aH0gLi4uYClcblxuICAgIEFwaXJWZXJzaW9uID0gKGF3YWl0IGFzeW5jX2ZzLnJlYWRGaWxlKGJ1aWxkUGF0aCArICcvc3JjX2luZm8vdmVyc2lvbi50eHQnLCAndXRmOCcpKS5yZXBsYWNlKC9cXG4kLywgXCJcIik7XG5cbiAgICBpZiAoUmFtYWxhbWFSZW1vdGluZ0ltYWdlID09PSB1bmRlZmluZWQpXG4gICAgICAgIFJhbWFsYW1hUmVtb3RpbmdJbWFnZSA9IChhd2FpdCBhc3luY19mcy5yZWFkRmlsZShidWlsZFBhdGggKyAnL3NyY19pbmZvL3JhbWFsYW1hLmltYWdlLWluZm8udHh0JywgJ3V0ZjgnKSkucmVwbGFjZSgvXFxuJC8sIFwiXCIpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpbml0aWFsaXplU3RvcmFnZURpcihzdG9yYWdlUGF0aCwgYnVpbGRQYXRoKSB7XG4gICAgY29uc29sZS5sb2coYEluaXRpYWxpemluZyB0aGUgc3RvcmFnZSBkaXJlY3RvcnkgLi4uYClcblxuICAgIGlmICghZnMuZXhpc3RzU3luYyhzdG9yYWdlUGF0aCkpe1xuICAgICAgICBmcy5ta2RpclN5bmMoc3RvcmFnZVBhdGgpO1xuICAgIH1cblxuICAgIGlmIChBcGlyVmVyc2lvbiA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJBUElSIHZlcnNpb24gbm90IGxvYWRlZC4gVGhpcyBpcyB1bmV4cGVjdGVkLlwiKTtcblxuICAgIExvY2FsQnVpbGREaXIgPSBgJHtzdG9yYWdlUGF0aH0vJHtBcGlyVmVyc2lvbn1gO1xuICAgIGlmICghZnMuZXhpc3RzU3luYyhMb2NhbEJ1aWxkRGlyKSl7XG4gICAgICAgIGNvcHlSZWN1cnNpdmUoYnVpbGRQYXRoLCBMb2NhbEJ1aWxkRGlyKVxuICAgICAgICAgICAgLnRoZW4oKCkgPT4gY29uc29sZS5sb2coJ0NvcHkgY29tcGxldGUnKSk7XG4gICAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYWN0aXZhdGUoZXh0ZW5zaW9uQ29udGV4dDogZXh0ZW5zaW9uQXBpLkV4dGVuc2lvbkNvbnRleHQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBpbml0aWFsaXplIHRoZSBnbG9iYWwgdmFyaWFibGVzIC4uLlxuICAgIEV4dGVuc2lvblN0b3JhZ2VQYXRoID0gZXh0ZW5zaW9uQ29udGV4dC5zdG9yYWdlUGF0aDtcbiAgICBjb25zb2xlLmxvZyhcIkFjdGl2YXRpbmcgdGhlIEFQSSBSZW1vdGluZyBleHRlbnNpb24gLi4uXCIpXG4gICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgaW5pdGlhbGl6ZUJ1aWxkRGlyKEVYVEVOU0lPTl9CVUlMRF9QQVRIKTtcbiAgICAgICAgY29uc29sZS5sb2coYEluc3RhbGxpbmcgQVBJUiB2ZXJzaW9uICR7QXBpclZlcnNpb259IC4uLmApO1xuICAgICAgICBjb25zb2xlLmxvZyhgVXNpbmcgaW1hZ2UgJHtSYW1hbGFtYVJlbW90aW5nSW1hZ2V9YCk7XG5cbiAgICAgICAgYXdhaXQgaW5pdGlhbGl6ZVN0b3JhZ2VEaXIoZXh0ZW5zaW9uQ29udGV4dC5zdG9yYWdlUGF0aCwgRVhURU5TSU9OX0JVSUxEX1BBVEgpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGBQcmVwYXJpbmcgdGhlIGtydW5raXQgYmluYXJpZXMgLi4uYCk7XG4gICAgICAgIGF3YWl0IHByZXBhcmVfa3J1bmtpdCgpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGBMb2FkaW5nIHRoZSBtb2RlbHMgLi4uYCk7XG4gICAgICAgIHJlZnJlc2hBdmFpbGFibGVNb2RlbHMoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBtc2cgPSBgQ291bGRuJ3QgaW5pdGlhbGl6ZSB0aGUgZXh0ZW5zaW9uOiAke2Vycm9yfWBcblxuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgLy8gdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxuXG4gICAgLy8gcmVnaXN0ZXIgdGhlIGNvbW1hbmQgcmVmZXJlbmNlZCBpbiBwYWNrYWdlLmpzb24gZmlsZVxuICAgIGNvbnN0IG1lbnVDb21tYW5kID0gZXh0ZW5zaW9uQXBpLmNvbW1hbmRzLnJlZ2lzdGVyQ29tbWFuZCgnbGxhbWEuY3BwLmFwaXIubWVudScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKEZBSUxfSUZfTk9UX01BQyAmJiAhZXh0ZW5zaW9uQXBpLmVudi5pc01hYykge1xuICAgICAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKGBsbGFtYS5jcHAgQVBJIFJlbW90aW5nIG9ubHkgc3VwcG9ydGVkIG9uIE1hY09TLmApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHJlc3VsdDtcbiAgICAgICAgaWYgKFNIT1dfSU5JVElBTF9NRU5VKSB7XG4gICAgICAgICAgICAvLyBkaXNwbGF5IGEgY2hvaWNlIHRvIHRoZSB1c2VyIGZvciBzZWxlY3Rpbmcgc29tZSB2YWx1ZXNcbiAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd1F1aWNrUGljayhPYmplY3Qua2V5cyhNQUlOX01FTlVfQ0hPSUNFUyksIHtcbiAgICAgICAgICAgICAgICB0aXRsZTogXCJXaGF0IGRvIHlvdSB3YW50IHRvIGRvP1wiLFxuICAgICAgICAgICAgICAgIGNhblBpY2tNYW55OiBmYWxzZSwgLy8gdXNlciBjYW4gc2VsZWN0IG1vcmUgdGhhbiBvbmUgY2hvaWNlXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlc3VsdCA9IE1BSU5fTUVOVV9DSE9JQ0VTWzJdO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHJlc3VsdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIk5vIHVzZXIgY2hvaWNlLCBhYm9ydGluZy5cIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgTUFJTl9NRU5VX0NIT0lDRVNbcmVzdWx0XSgpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc3QgbXNnID0gYFRhc2sgZmFpbGVkOiAke1N0cmluZyhlcnJvcil9YDtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbiAgICAgICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuXG4gICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHRyeSB7XG4gICAgICAgIC8vIGNyZWF0ZSBhbiBpdGVtIGluIHRoZSBzdGF0dXMgYmFyIHRvIHJ1biBvdXIgY29tbWFuZFxuICAgICAgICAvLyBpdCB3aWxsIHN0aWNrIG9uIHRoZSBsZWZ0IG9mIHRoZSBzdGF0dXMgYmFyXG4gICAgICAgIGNvbnN0IGl0ZW0gPSBleHRlbnNpb25BcGkud2luZG93LmNyZWF0ZVN0YXR1c0Jhckl0ZW0oZXh0ZW5zaW9uQXBpLlN0YXR1c0JhckFsaWduTGVmdCwgMTAwKTtcbiAgICAgICAgaXRlbS50ZXh0ID0gJ0xsYW1hLmNwcCBBUEkgUmVtb3RpbmcnO1xuICAgICAgICBpdGVtLmNvbW1hbmQgPSAnbGxhbWEuY3BwLmFwaXIubWVudSc7XG4gICAgICAgIGl0ZW0uc2hvdygpO1xuXG4gICAgICAgIC8vIHJlZ2lzdGVyIGRpc3Bvc2FibGUgcmVzb3VyY2VzIHRvIGl0J3MgcmVtb3ZlZCB3aGVuIHlvdSBkZWFjdGl2dGUgdGhlIGV4dGVuc2lvblxuICAgICAgICBleHRlbnNpb25Db250ZXh0LnN1YnNjcmlwdGlvbnMucHVzaChtZW51Q29tbWFuZCk7XG4gICAgICAgIGV4dGVuc2lvbkNvbnRleHQuc3Vic2NyaXB0aW9ucy5wdXNoKGl0ZW0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBDb3VsZG4ndCBzdWJzY3JpYmUgdGhlIGV4dGVuc2lvbiB0byBQb2RtYW4gRGVza3RvcDogJHtlcnJvcn1gXG5cbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlYWN0aXZhdGUoKTogUHJvbWlzZTx2b2lkPiB7XG5cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzdGFydF9wb2RtYW5fbWFjaGluZV93aXRoX2FwaXIoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKExvY2FsQnVpbGREaXIgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWxCdWlsZERpciBub3QgbG9hZGVkLiBUaGlzIGlzIHVuZXhwZWN0ZWQuXCIpO1xuXG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKGBSZXN0YXJ0aW5nIFBvZG1hbiBtYWNoaW5lIHdpdGggQVBJUiBzdXBwb3J0IC4uLmApO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4dGVuc2lvbkFwaS5wcm9jZXNzLmV4ZWMoXCIvdXNyL2Jpbi9lbnZcIiwgW1wiYmFzaFwiLCBgJHtMb2NhbEJ1aWxkRGlyfS9wb2RtYW5fc3RhcnRfbWFjaGluZS5hcGlfcmVtb3Rpbmcuc2hgXSwge2N3ZDogTG9jYWxCdWlsZERpcn0pO1xuXG4gICAgICAgIGNvbnN0IG1zZyA9IFwiUG9kbWFuIG1hY2hpbmUgc3VjY2Vzc2Z1bGx5IHJlc3RhcnRlZCB3aXRoIHRoZSBBUElSIGxpYnJhcmllc1wiXG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShtc2cpO1xuICAgICAgICBjb25zb2xlLmxvZyhtc2cpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBGYWlsZWQgdG8gcmVzdGFydCBwb2RtYW4gbWFjaGluZSB3aXRoIHRoZSBBUEkgbGlicmFyaWVzOiAke2Vycm9yfWBcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXN0YXJ0X3BvZG1hbl9tYWNoaW5lX3dpdGhvdXRfYXBpcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UoYFJlc3RhcnRpbmcgUG9kbWFuIG1hY2hpbmUgd2l0aG91dCBBUEkgUmVtb3Rpbmcgc3VwcG9ydGApO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc29sZS5sb2coYFN0b3BwaW5nIHRoZSBQb2RNYW4gTWFjaGluZSAuLi5gKTtcbiAgICAgICAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4dGVuc2lvbkFwaS5wcm9jZXNzLmV4ZWMoXCJwb2RtYW5cIiwgWydtYWNoaW5lJywgJ3N0b3AnXSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgbXNnID0gYEZhaWxlZCB0byBzdG9wIHRoZSBQb2RNYW4gTWFjaGluZTogJHtlcnJvcn1gO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmxvZyhgU3RhcnRpbmcgdGhlIFBvZE1hbiBNYWNoaW5lIC4uLmApO1xuICAgICAgICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLnByb2Nlc3MuZXhlYyhcInBvZG1hblwiLCBbJ21hY2hpbmUnLCAnc3RhcnQnXSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgbXNnID0gYEZhaWxlZCB0byByZXN0YXJ0IHRoZSBQb2RNYW4gTWFjaGluZTogJHtlcnJvcn1gO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG5cbiAgICBjb25zdCBtc2cgPSBcIlBvZE1hbiBNYWNoaW5lIHN1Y2Nlc3NmdWxseSByZXN0YXJ0ZWQgd2l0aG91dCBBUEkgUmVtb3Rpbmcgc3VwcG9ydFwiO1xuICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShtc2cpO1xuICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcHJlcGFyZV9rcnVua2l0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChMb2NhbEJ1aWxkRGlyID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsQnVpbGREaXIgbm90IGxvYWRlZC4gVGhpcyBpcyB1bmV4cGVjdGVkLlwiKTtcblxuICAgIGlmIChmcy5leGlzdHNTeW5jKGAke0xvY2FsQnVpbGREaXJ9L2Jpbi9rcnVua2l0YCkpIHtcbiAgICAgICAgY29uc29sZS5sb2coXCJCaW5hcmllcyBhbHJlYWR5IHByZXBhcmVkLlwiKVxuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKGBQcmVwYXJpbmcgdGhlIGtydW5raXQgYmluYXJpZXMgZm9yIEFQSSBSZW1vdGluZyAuLi5gKTtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleHRlbnNpb25BcGkucHJvY2Vzcy5leGVjKFwiL3Vzci9iaW4vZW52XCIsIFtcImJhc2hcIiwgYCR7TG9jYWxCdWlsZERpcn0vdXBkYXRlX2tydW5raXQuc2hgXSwge2N3ZDogTG9jYWxCdWlsZERpcn0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IHVwZGF0ZSB0aGUga3J1bmtpdCBiaW5hcmllczogJHtlcnJvcn06ICR7ZXJyb3Iuc3Rkb3V0fWApO1xuICAgIH1cbiAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UoYEJpbmFyaWVzIHN1Y2Nlc3NmdWxseSBwcmVwYXJlZCFgKTtcblxuICAgIGNvbnNvbGUubG9nKFwiQmluYXJpZXMgc3VjY2Vzc2Z1bGx5IHByZXBhcmVkIVwiKVxufVxuXG5hc3luYyBmdW5jdGlvbiBjaGVja1BvZG1hbk1hY2hpbmVTdGF0dXMod2l0aF9ndWkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLnByb2Nlc3MuZXhlYyhcIi91c3IvYmluL2VudlwiLCBbXCJiYXNoXCIsIGAke0VYVEVOU0lPTl9CVUlMRF9QQVRIfS9jaGVja19wb2RtYW5fbWFjaGluZV9zdGF0dXMuc2hgXSwge2N3ZDogTG9jYWxCdWlsZERpcn0pO1xuICAgICAgICAvLyBleGl0IHdpdGggc3VjY2Vzcywga3J1bmtpdCBpcyBydW5uaW5nIEFQSSByZW1vdGluZ1xuICAgICAgICBjb25zdCBzdGF0dXMgPSBzdGRvdXQucmVwbGFjZSgvXFxuJC8sIFwiXCIpXG4gICAgICAgIGNvbnN0IG1zZyA9IGBQb2RtYW4gTWFjaGluZSBBUEkgUmVtb3Rpbmcgc3RhdHVzOlxcbiR7c3RhdHVzfWBcbiAgICAgICAgaWYgKHdpdGhfZ3VpKSB7XG4gICAgICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UobXNnKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zb2xlLmxvZyhtc2cpO1xuXG4gICAgICAgIHJldHVybiAwO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vY29uc29sZS5lcnJvcihlcnJvcik7XG4gICAgICAgIGxldCBtc2c7XG4gICAgICAgIGNvbnN0IHN0YXR1cyA9IGVycm9yLnN0ZG91dC5yZXBsYWNlKC9cXG4kLywgXCJcIilcbiAgICAgICAgY29uc3QgZXhpdENvZGUgPSBlcnJvci5leGl0Q29kZTtcblxuICAgICAgICBpZiAoZXhpdENvZGUgPiAxMCAmJiBleGl0Q29kZSA8IDIwKSB7XG4gICAgICAgICAgICAvLyBleGl0IHdpdGggY29kZSAxeCA9PT4gc3VjY2Vzc2Z1bCBjb21wbGV0aW9uLCBidXQgbm90IEFQSSBSZW1vdGluZyBzdXBwb3J0XG4gICAgICAgICAgICBtc2cgPWBQb2RtYW4gTWFjaGluZSBzdGF0dXM6ICR7c3RhdHVzfTogc3RhdHVzICMke2V4aXRDb2RlfWA7XG4gICAgICAgICAgICBpZiAod2l0aF9ndWkpIHtcbiAgICAgICAgICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnNvbGUud2Fybihtc2cpXG4gICAgICAgICAgICByZXR1cm4gZXhpdENvZGU7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBvdGhlciBleGl0IGNvZGUgY3Jhc2ggb2YgdW5zdWNjZXNzZnVsIGNvbXBsZXRpb25cbiAgICAgICAgbXNnID1gRmFpbGVkIHRvIGNoZWNrIFBvZE1hbiBNYWNoaW5lIHN0YXR1czogJHtzdGF0dXN9IChjb2RlICMke2V4aXRDb2RlfSlgO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG59XG4iXSwibmFtZXMiOlsiY29udGFpbmVyRW5naW5lIiwiY29udGFpbmVySW5mbyIsImV4dGVuc2lvbkFwaSIsImVyciIsInByb3ZpZGVyIiwiY29ubmVjdGlvbiIsImltYWdlSW5mbyIsIm1zZyJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQWNPLE1BQU0sTUFBQSxHQUFpQjtBQUU5QixNQUFNLElBQUEsR0FBTyxRQUFRLE1BQU0sQ0FBQTtBQUMzQixNQUFNLEVBQUEsR0FBSyxRQUFRLElBQUksQ0FBQTtBQUN2QixNQUFNLFFBQUEsR0FBVyxRQUFRLGFBQWEsQ0FBQTtBQUV0QyxNQUFNLGtCQUFrQixFQUFDO0FBQ3pCLElBQUksb0JBQUEsR0FBdUIsTUFBQTtBQUszQixNQUFNLG9CQUFBLEdBQXVCLElBQUEsQ0FBSyxLQUFBLENBQU0sVUFBVSxFQUFFLEdBQUEsR0FBTSxXQUFBO0FBRzFELElBQUkscUJBQUEsR0FBd0IsTUFBQTtBQUM1QixJQUFJLFdBQUEsR0FBYyxNQUFBO0FBQ2xCLElBQUksYUFBQSxHQUFnQixNQUFBO0FBRXBCLE1BQU0saUJBQUEsR0FBb0I7QUFBQSxFQUN0QixrREFBQSxFQUFvRCxNQUFNLGdDQUFBLEVBQWlDO0FBQUEsRUFDM0YsdURBQUEsRUFBeUQsTUFBTSxtQ0FBQSxFQUFvQztBQUFBLEVBQ25HLHFEQUFBLEVBQXVELE1BQU0seUJBQUEsRUFBMEI7QUFBQSxFQUN2RiwyQ0FBQSxFQUE2QyxNQUFNLHdCQUFBLENBQXlCLElBQUk7QUFDcEYsQ0FBQTtBQUVBLFNBQVMsZUFBQSxDQUFnQixTQUFBLEVBQVcsTUFBQSxFQUFRLFFBQUEsRUFBVTtBQUNsRCxFQUFBLElBQUksQ0FBQyxFQUFBLENBQUcsVUFBQSxDQUFXLFNBQVMsQ0FBQSxFQUFHO0FBQzNCLElBQUEsT0FBQSxDQUFRLEdBQUEsQ0FBSSxXQUFXLFNBQVMsQ0FBQTtBQUNoQyxJQUFBO0FBQUEsRUFDSjtBQUVBLEVBQUEsSUFBSSxLQUFBLEdBQVEsRUFBQSxDQUFHLFdBQUEsQ0FBWSxTQUFTLENBQUE7QUFDcEMsRUFBQSxLQUFBLElBQVMsQ0FBQSxHQUFJLENBQUEsRUFBRyxDQUFBLEdBQUksS0FBQSxDQUFNLFFBQVEsQ0FBQSxFQUFBLEVBQUs7QUFDbkMsSUFBQSxJQUFJLFdBQVcsSUFBQSxDQUFLLElBQUEsQ0FBSyxTQUFBLEVBQVcsS0FBQSxDQUFNLENBQUMsQ0FBQyxDQUFBO0FBQzVDLElBQUEsSUFBSSxJQUFBLEdBQU8sRUFBQSxDQUFHLFNBQUEsQ0FBVSxRQUFRLENBQUE7QUFDaEMsSUFBQSxJQUFJLElBQUEsQ0FBSyxhQUFZLEVBQUc7QUFDcEIsTUFBQSxlQUFBLENBQWdCLFFBQUEsRUFBVSxRQUFRLFFBQVEsQ0FBQTtBQUFBLElBQzlDLENBQUEsTUFBQSxJQUFXLFFBQUEsQ0FBUyxRQUFBLENBQVMsTUFBTSxDQUFBLEVBQUc7QUFDbEMsTUFBQSxRQUFBLENBQVMsUUFBUSxDQUFBO0FBQUEsSUFDckI7QUFBQyxFQUNMO0FBQ0o7QUFHQSxlQUFlLGFBQUEsQ0FBYyxLQUFLLElBQUEsRUFBTTtBQUN0QyxFQUFBLE1BQU0sT0FBQSxHQUFVLE1BQU0sUUFBQSxDQUFTLE9BQUEsQ0FBUSxLQUFLLEVBQUUsYUFBQSxFQUFlLE1BQU0sQ0FBQTtBQUVuRSxFQUFBLE1BQU0sU0FBUyxLQUFBLENBQU0sSUFBQSxFQUFNLEVBQUUsU0FBQSxFQUFXLE1BQU0sQ0FBQTtBQUU5QyxFQUFBLEtBQUEsSUFBUyxTQUFTLE9BQUEsRUFBUztBQUN6QixJQUFBLE1BQU0sT0FBQSxHQUFVLElBQUEsQ0FBSyxJQUFBLENBQUssR0FBQSxFQUFLLE1BQU0sSUFBSSxDQUFBO0FBQ3pDLElBQUEsTUFBTSxRQUFBLEdBQVcsSUFBQSxDQUFLLElBQUEsQ0FBSyxJQUFBLEVBQU0sTUFBTSxJQUFJLENBQUE7QUFFM0MsSUFBQSxJQUFJLEtBQUEsQ0FBTSxhQUFZLEVBQUc7QUFDdkIsTUFBQSxNQUFNLGFBQUEsQ0FBYyxTQUFTLFFBQVEsQ0FBQTtBQUFBLElBQ3ZDLENBQUEsTUFBTztBQUNMLE1BQUEsTUFBTSxRQUFBLENBQVMsUUFBQSxDQUFTLE9BQUEsRUFBUyxRQUFRLENBQUE7QUFBQSxJQUMzQztBQUFBLEVBQ0Y7QUFDRjtBQUVBLE1BQU0sa0JBQWtCLE1BQWM7QUFFcEMsRUFBQSxPQUFBLENBQVEsSUFBQSxDQUFLLFFBQU8sR0FBSSxDQUFBLEVBQUcsU0FBUyxFQUFFLENBQUEsQ0FBRSxVQUFVLENBQUMsQ0FBQTtBQUNyRCxDQUFBO0FBRUEsU0FBUyxzQkFBQSxHQUF5QjtBQUM5QixFQUFBLElBQUksb0JBQUEsS0FBeUIsTUFBQSxFQUFXLE1BQU0sSUFBSSxNQUFNLHFDQUFxQyxDQUFBO0FBRzdGLEVBQUEsTUFBQSxDQUFPLElBQUEsQ0FBSyxlQUFlLENBQUEsQ0FBRSxPQUFBLENBQVEsU0FBTyxPQUFPLGVBQUEsQ0FBZ0IsR0FBRyxDQUFDLENBQUE7QUFFdkUsRUFBQSxNQUFNLGFBQUEsR0FBZ0IsU0FBUyxRQUFBLEVBQVU7QUFDckMsSUFBQSxNQUFNLFdBQVcsUUFBQSxDQUFTLEtBQUEsQ0FBTSxHQUFHLENBQUEsQ0FBRSxHQUFHLEVBQUUsQ0FBQTtBQUMxQyxJQUFBLE1BQU0sVUFBQSxHQUFhLFFBQUEsQ0FBUyxLQUFBLENBQU0sR0FBRyxDQUFBO0FBRXJDLElBQUEsTUFBTSxTQUFBLEdBQVksVUFBQSxDQUFXLEVBQUEsQ0FBRyxDQUFDLENBQUE7QUFDakMsSUFBQSxNQUFNLGFBQWEsVUFBQSxDQUFXLEtBQUEsQ0FBTSxDQUFDLENBQUEsQ0FBRSxLQUFLLEdBQUcsQ0FBQTtBQUMvQyxJQUFBLE1BQU0sZUFBQSxHQUFrQixDQUFBLEVBQUcsU0FBUyxDQUFBLENBQUEsRUFBSSxVQUFVLENBQUEsQ0FBQTtBQUNsRCxJQUFBLGVBQUEsQ0FBZ0IsZUFBZSxDQUFBLEdBQUksUUFBQTtBQUNuQyxJQUFBLE9BQUEsQ0FBUSxHQUFBLENBQUksQ0FBQSxNQUFBLEVBQVMsZUFBZSxDQUFBLENBQUUsQ0FBQTtBQUFBLEVBQzFDLENBQUE7QUFFQSxFQUFBLGVBQUEsQ0FBZ0Isb0JBQUEsR0FBdUIsMEJBQUEsRUFBNEIsT0FBQSxFQUFTLGFBQWEsQ0FBQTtBQUM3RjtBQU1BLGVBQWUsdUJBQUEsR0FBMEI7QUFDckMsRUFBQSxNQUFNLGFBQUEsR0FBQSxDQUNDLE1BQU1BLDRCQUFBLENBQWdCLGNBQUEsSUFDdEIsSUFBQSxDQUFLLENBQUFDLGNBQUFBLEtBQWtCQSxjQUFBQSxDQUFjLE9BQU8sZ0JBQWdCLENBQUEsS0FBTSxNQUFBLElBQVVBLGNBQUFBLENBQWMsVUFBVSxTQUFVLENBQUE7QUFFckgsRUFBQSxPQUFPLGFBQUEsRUFBZSxFQUFBO0FBQzFCO0FBRUEsZUFBZSx5QkFBQSxHQUE0QjtBQUN2QyxFQUFBLE1BQU0sV0FBQSxHQUFjLE1BQU0sdUJBQUEsRUFBd0I7QUFDbEQsRUFBQSxJQUFJLGdCQUFnQixNQUFBLEVBQVc7QUFDM0IsSUFBQSxPQUFBLENBQVEsTUFBTSwyREFBMkQsQ0FBQTtBQUN6RSxJQUFBLE1BQU1DLHVCQUFBLENBQWEsTUFBQSxDQUFPLGdCQUFBLENBQWlCLENBQUEsdUJBQUEsRUFBMEIsV0FBVyxDQUFBLGlHQUFBLENBQW1HLENBQUE7QUFDbkwsSUFBQTtBQUFBLEVBQ0o7QUFFQSxFQUFBLE1BQU0sTUFBQSxHQUFTLE1BQU0sd0JBQUEsQ0FBeUIsS0FBSyxDQUFBO0FBQ25ELEVBQUEsSUFBSSxXQUFXLENBQUEsRUFBRztBQUNkLElBQUEsTUFBTSxHQUFBLEdBQU0sbUdBQW1HLE1BQU0sQ0FBQSxDQUFBLENBQUE7QUFDckgsSUFBQSxPQUFBLENBQVEsS0FBSyxHQUFHLENBQUE7QUFDaEIsSUFBQSxNQUFNQSx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxnQkFBQSxDQUFpQixHQUFHLENBQUE7QUFDOUMsSUFBQTtBQUFBLEVBQ0o7QUFFQSxFQUFBLElBQUkscUJBQUEsS0FBMEIsTUFBQSxFQUFXLE1BQU0sSUFBSSxNQUFNLDhEQUE4RCxDQUFBO0FBRXZILEVBQUEsSUFBSSxNQUFBLENBQU8sSUFBQSxDQUFLLGVBQWUsQ0FBQSxDQUFFLFdBQVcsQ0FBQSxFQUFHO0FBQzNDLElBQUEsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUIsdUZBQXVGLENBQUE7QUFDbEksSUFBQTtBQUFBLEVBQ0o7QUFDQSxFQUFBLElBQUksVUFBQTtBQUNKLEVBQTRCO0FBQ3hCLElBQUEsc0JBQUEsRUFBdUI7QUFHdkIsSUFBQSxVQUFBLEdBQWEsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sY0FBYyxNQUFBLENBQU8sSUFBQSxDQUFLLGVBQWUsQ0FBQSxFQUFHO0FBQUEsTUFDL0UsV0FBQSxFQUFhLEtBQUE7QUFBQTtBQUFBLE1BQ2IsS0FBQSxFQUFPO0FBQUEsS0FDVixDQUFBO0FBQ0QsSUFBQSxJQUFJLGVBQWUsTUFBQSxFQUFXO0FBQzFCLE1BQUEsT0FBQSxDQUFRLEtBQUsscUNBQXFDLENBQUE7QUFDbEQsTUFBQTtBQUFBLElBQ0o7QUFBQSxFQUVKO0FBS0EsRUFBQSxJQUFJLFNBQUEsR0FBWSxNQUFNQSx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxhQUFhLEVBQUMsS0FBQSxFQUFPLGNBQUEsRUFBZ0IsTUFBQSxFQUFRLG9DQUFBLEVBQXNDLEtBQUEsRUFBTyxRQUFRLGFBQUEsRUFBZSxDQUFDLFVBQVMsUUFBQSxDQUFTLEtBQUEsRUFBTyxFQUFFLENBQUEsR0FBSSxJQUFBLEdBQU8sRUFBQSxHQUFJLDJCQUFBLEVBQTRCLENBQUE7QUFDbE8sRUFBQSxTQUFBLEdBQVksU0FBUyxTQUFTLENBQUE7QUFFOUIsRUFBQSxJQUFJLFNBQUEsS0FBYyxNQUFBLElBQWEsTUFBQSxDQUFPLEtBQUEsQ0FBTSxTQUFTLENBQUEsRUFBRztBQUNwRCxJQUFBLE9BQUEsQ0FBUSxLQUFLLHlDQUF5QyxDQUFBO0FBQ3RELElBQUE7QUFBQSxFQUNKO0FBR0EsRUFBQSxNQUFNLFlBQXVCLE1BQU0sU0FBQTtBQUFBLElBQy9CLHFCQUVKLENBQUE7QUFJQSxFQUFBLE1BQU0sU0FBQSxHQUFZLGdCQUFnQixVQUFVLENBQUE7QUFDNUMsRUFBQSxJQUFJLFNBQUEsS0FBYyxNQUFBO0FBQ2QsSUFBQSxNQUFNLElBQUksS0FBQSxDQUFNLENBQUEsNENBQUEsRUFBK0MsU0FBUyxDQUFBLHFCQUFBLENBQXVCLENBQUE7QUFFbkcsRUFBQSxNQUFNLGNBQUEsR0FBaUIsSUFBQSxDQUFLLFFBQUEsQ0FBUyxTQUFTLENBQUE7QUFDOUMsRUFBQSxNQUFNLGdCQUFnQixJQUFBLENBQUssUUFBQSxDQUFTLElBQUEsQ0FBSyxPQUFBLENBQVEsU0FBUyxDQUFDLENBQUE7QUFDM0QsRUFBQSxNQUFNLFVBQUEsR0FBYSxXQUFXLGNBQWMsQ0FBQSxDQUFBO0FBQzVDLEVBQUEsTUFBTSxXQUFBLEdBQWMsS0FBQTtBQUdwQixFQUFBLE1BQU0sTUFBQSxHQUFpQztBQUFBLElBQ25DLENBQUMseUJBQXlCLEdBQUcsS0FBSyxTQUFBLENBQVUsQ0FBQyxhQUFhLENBQUMsQ0FBQTtBQUFBLElBQzNELENBQUMsS0FBSyxHQUFHLENBQUEsaUJBQUEsRUFBb0IsU0FBUyxDQUFBLEdBQUEsQ0FBQTtBQUFBLElBQ3RDLENBQUMsTUFBTSxHQUFHLENBQUEsaUJBQUEsRUFBb0IsV0FBVyxhQUFhLFNBQVMsQ0FBQSxDQUFBO0FBQUEsSUFDL0QsQ0FBQyxLQUFLLEdBQUcsQ0FBQSxzQkFBQSxDQUFBO0FBQUEsSUFDVCxDQUFDLFlBQVksR0FBRyxlQUFBLEVBQWdCO0FBQUEsSUFDaEMsQ0FBQyxnQkFBZ0IsR0FBRztBQUFBLEdBQ3hCO0FBSUEsRUFBQSxNQUFNLE1BQUEsR0FBc0I7QUFBQSxJQUMxQjtBQUFBLE1BQ0ksTUFBQSxFQUFRLFVBQUE7QUFBQSxNQUNSLE1BQUEsRUFBUSxTQUFBO0FBQUEsTUFDUixJQUFBLEVBQU07QUFBQTtBQUNWLEdBQ0Y7QUFHQSxFQUFBLElBQUksVUFBQSxHQUFpQyxNQUFBO0FBQ3JDLEVBQUEsSUFBSSxNQUFnQixFQUFDO0FBRXJCLEVBQUEsVUFBQSxHQUFhLDBCQUFBO0FBR2IsRUFBQSxNQUFNLE9BQWlCLENBQUMsQ0FBQSxXQUFBLEVBQWMsVUFBVSxDQUFBLENBQUEsRUFBSSxjQUFBLEVBQWdCLGFBQWEsZ0JBQWdCLENBQUE7QUFHakcsRUFBQSxNQUFNLFVBQW9CLEVBQUM7QUFDM0IsRUFBQSxPQUFBLENBQVEsSUFBQSxDQUFLO0FBQUEsSUFDVCxVQUFBLEVBQVksVUFBQTtBQUFBLElBQ1osZUFBQSxFQUFpQixVQUFBO0FBQUEsSUFDakIsaUJBQUEsRUFBbUI7QUFBQSxHQUN0QixDQUFBO0FBRUQsRUFBQSxNQUFNLGlCQUFrQyxFQUFDO0FBQ3pDLEVBQUEsY0FBQSxDQUFlLElBQUEsQ0FBSztBQUFBLElBQ2hCLFlBQUEsRUFBYyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUE7QUFBQSxJQUN0QixLQUFBLEVBQU87QUFBQTtBQUFBLEdBQ1YsQ0FBQTtBQUdELEVBQUEsTUFBTSxzQkFBQSxHQUFpRDtBQUFBLElBQ25ELE9BQU8sU0FBQSxDQUFVLEVBQUE7QUFBQSxJQUNqQixNQUFBLEVBQVEsSUFBQTtBQUFBLElBQ1IsVUFBQSxFQUFZLFVBQUE7QUFBQSxJQUNaLEdBQUEsRUFBSyxHQUFBO0FBQUEsSUFDTCxZQUFBLEVBQWMsRUFBRSxDQUFDLENBQUEsRUFBRyxTQUFTLENBQUEsQ0FBRSxHQUFHLEVBQUMsRUFBRTtBQUFBLElBQ3JDLFVBQUEsRUFBWTtBQUFBLE1BQ1IsVUFBQSxFQUFZLEtBQUE7QUFBQSxNQUNaLE9BQUEsRUFBUyxPQUFBO0FBQUEsTUFDVCxNQUFBLEVBQVEsTUFBQTtBQUFBLE1BQ1IsY0FBQSxFQUFnQixjQUFBO0FBQUEsTUFDaEIsV0FBQSxFQUFhLENBQUMsZUFBZSxDQUFBO0FBQUEsTUFDN0IsWUFBQSxFQUFjO0FBQUEsUUFDVixVQUFBLEVBQVk7QUFBQSxVQUNSO0FBQUEsWUFDSSxRQUFBLEVBQVUsR0FBRyxTQUFTLENBQUE7QUFBQTtBQUMxQjtBQUNKO0FBQ0osS0FDSjtBQUFBLElBRUEsV0FBQSxFQUFhO0FBQUE7QUFBQSxNQUVYLElBQUEsRUFBTSxDQUFDLFdBQUEsRUFBYSxDQUFBLG9DQUFBLENBQXNDLENBQUE7QUFBQSxNQUMxRCxVQUFVLE1BQUEsR0FBUyxDQUFBO0FBQUEsTUFDbkIsU0FBUyxDQUFBLEdBQUk7QUFBQSxLQUNiO0FBQUEsSUFDRixNQUFBLEVBQVEsTUFBQTtBQUFBLElBQ1IsR0FBQSxFQUFLO0FBQUEsR0FDVDtBQUNBLEVBQUEsT0FBQSxDQUFRLEdBQUEsQ0FBSSx3QkFBd0IsTUFBTSxDQUFBO0FBRTFDLEVBQUEsTUFBTSxFQUFFLFVBQVUsRUFBQSxFQUFHLEdBQUksTUFBTSxlQUFBLENBQWdCLFNBQUEsQ0FBVSxRQUFBLEVBQVUsc0JBQThCLENBQUE7QUFFakcsRUFBQSxNQUFNQSx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxzQkFBQSxDQUF1QixDQUFBLHVCQUFBLEVBQTBCLEVBQUUsQ0FBQSxtQkFBQSxDQUFxQixDQUFBO0FBRXRHO0FBR0EsZUFBZSxlQUFBLENBQ1gsUUFBQSxFQUNBLHNCQUFBLEVBQ0EsTUFBQSxFQUNvQztBQUVwQyxFQUFBLE9BQUEsQ0FBUSxJQUFJLHdCQUF3QixDQUFBO0FBQ3BDLEVBQUEsSUFBSTtBQUNBLElBQUEsTUFBTSxNQUFBLEdBQVMsTUFBTUYsNEJBQUEsQ0FBZ0IsZUFBQSxDQUFnQixVQUFVLHNCQUFzQixDQUFBO0FBQ3JGLElBQUEsT0FBQSxDQUFRLElBQUksb0JBQW9CLENBQUE7QUFHaEMsSUFBQSxPQUFPO0FBQUEsTUFDSCxJQUFJLE1BQUEsQ0FBTyxFQUFBO0FBQUEsTUFDWDtBQUFBLEtBQ0o7QUFBQSxFQUNKLFNBQVNHLElBQUFBLEVBQWM7QUFDbkIsSUFBQSxNQUFNLEdBQUEsR0FBTSxDQUFBLDZCQUFBLEVBQWdDLE1BQUEsQ0FBT0EsSUFBRyxDQUFDLENBQUEsQ0FBQTtBQUN2RCxJQUFBLE9BQUEsQ0FBUSxNQUFNLEdBQUcsQ0FBQTtBQUNqQixJQUFBLE1BQU1ELHVCQUFBLENBQWEsTUFBQSxDQUFPLGdCQUFBLENBQWlCLEdBQUcsQ0FBQTtBQUM5QyxJQUFBLE1BQU1DLElBQUFBO0FBQUEsRUFDVjtBQUNKO0FBRUEsZUFBZSxTQUFBLENBQ1gsT0FDQSxNQUFBLEVBQ2tCO0FBRWxCLEVBQUEsT0FBQSxDQUFRLEdBQUEsQ0FBSSxDQUFBLGtCQUFBLEVBQXFCLEtBQUssQ0FBQSxJQUFBLENBQU0sQ0FBQTtBQUU1QyxFQUFBLE1BQU0sU0FBQSxHQUEyQ0Msc0JBQVMsdUJBQUEsRUFBd0I7QUFDbEYsRUFBQSxNQUFNLGNBQUEsR0FBaUIsU0FBQSxDQUNoQixNQUFBLENBQU8sQ0FBQyxFQUFFLFlBQUFDLFdBQUFBLEVBQVcsS0FBTUEsV0FBQUEsQ0FBVyxJQUFBLEtBQVMsUUFBUSxDQUFBO0FBQzlELEVBQUEsSUFBSSxDQUFDLGNBQUEsRUFBZ0IsTUFBTSxJQUFJLE1BQU0sQ0FBQSwyQkFBQSxDQUE2QixDQUFBO0FBRWxFLEVBQUEsSUFBSSxVQUFBLEdBQTBDLGNBQUEsQ0FBZSxDQUFDLENBQUEsQ0FBRSxVQUFBO0FBR2hFLEVBQUEsT0FBTyxZQUFBLENBQWEsVUFBQSxFQUFZLEtBQUEsRUFBTyxDQUFDLE1BQUEsS0FBc0I7QUFBQSxFQUFDLENBQUMsQ0FBQSxDQUMzRCxLQUFBLENBQU0sQ0FBQ0YsSUFBQUEsS0FBaUI7QUFDckIsSUFBQSxPQUFBLENBQVEsTUFBTSxDQUFBLG1DQUFBLEVBQXNDLEtBQUssS0FBSyxNQUFBLENBQU9BLElBQUcsQ0FBQyxDQUFBLENBQUUsQ0FBQTtBQUMzRSxJQUFBLE1BQU1BLElBQUFBO0FBQUEsRUFDVixDQUFDLENBQUEsQ0FDQSxJQUFBLENBQUssQ0FBQSxTQUFBLEtBQWE7QUFDZixJQUFBLE9BQUEsQ0FBUSxJQUFJLDJCQUEyQixDQUFBO0FBQ3ZDLElBQUEsT0FBTyxTQUFBO0FBQUEsRUFDWCxDQUFDLENBQUE7QUFDVDtBQUVBLGVBQWUsWUFBQSxDQUNiLFVBQUEsRUFDQSxLQUFBLEVBQ0EsUUFBQSxFQUNvQjtBQUNsQixFQUFBLElBQUksU0FBQSxHQUFZLE1BQUE7QUFFaEIsRUFBQSxJQUFJO0FBRUEsSUFBQSxNQUFNSCw0QkFBQSxDQUFnQixTQUFBLENBQVUsVUFBQSxFQUFZLEtBQUEsRUFBTyxRQUFRLENBQUE7QUFHM0QsSUFBQSxTQUFBLEdBQUEsQ0FDSSxNQUFNQSw2QkFBZ0IsVUFBQSxDQUFXO0FBQUEsTUFDN0IsUUFBQSxFQUFVO0FBQUEsS0FDUSxDQUFBLEVBQ3hCLElBQUEsQ0FBSyxDQUFBTSxVQUFBQSxLQUFhQSxVQUFBQSxDQUFVLFFBQUEsRUFBVSxJQUFBLENBQUssQ0FBQSxHQUFBLEtBQU8sR0FBQSxLQUFRLEtBQUssQ0FBQyxDQUFBO0FBQUEsRUFFdEUsU0FBU0gsSUFBQUEsRUFBYztBQUNuQixJQUFBLE9BQUEsQ0FBUSxJQUFBLENBQUssMERBQTBEQSxJQUFHLENBQUE7QUFDMUUsSUFBQSxNQUFNRCx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxnQkFBQSxDQUFpQixDQUFBLHdEQUFBLEVBQTJEQyxJQUFHLENBQUEsQ0FBRSxDQUFBO0FBRTNHLElBQUEsTUFBTUEsSUFBQUE7QUFBQSxFQUNWO0FBRUEsRUFBQSxJQUFJLGNBQWMsTUFBQSxFQUFXLE1BQU0sSUFBSSxLQUFBLENBQU0sQ0FBQSxNQUFBLEVBQVMsS0FBSyxDQUFBLFdBQUEsQ0FBYSxDQUFBO0FBRXhFLEVBQUEsT0FBTyxTQUFBO0FBQ1g7QUFFQSxlQUFlLG1CQUFtQixTQUFBLEVBQVc7QUFDekMsRUFBQSxPQUFBLENBQVEsR0FBQSxDQUFJLENBQUEsc0NBQUEsRUFBeUMsU0FBUyxDQUFBLElBQUEsQ0FBTSxDQUFBO0FBRXBFLEVBQUEsV0FBQSxHQUFBLENBQWUsTUFBTSxTQUFTLFFBQUEsQ0FBUyxTQUFBLEdBQVkseUJBQXlCLE1BQU0sQ0FBQSxFQUFHLE9BQUEsQ0FBUSxLQUFBLEVBQU8sRUFBRSxDQUFBO0FBRXRHLEVBQUEsSUFBSSxxQkFBQSxLQUEwQixNQUFBO0FBQzFCLElBQUEscUJBQUEsR0FBQSxDQUF5QixNQUFNLFNBQVMsUUFBQSxDQUFTLFNBQUEsR0FBWSxxQ0FBcUMsTUFBTSxDQUFBLEVBQUcsT0FBQSxDQUFRLEtBQUEsRUFBTyxFQUFFLENBQUE7QUFDcEk7QUFFQSxlQUFlLG9CQUFBLENBQXFCLGFBQWEsU0FBQSxFQUFXO0FBQ3hELEVBQUEsT0FBQSxDQUFRLElBQUksQ0FBQSxzQ0FBQSxDQUF3QyxDQUFBO0FBRXBELEVBQUEsSUFBSSxDQUFDLEVBQUEsQ0FBRyxVQUFBLENBQVcsV0FBVyxDQUFBLEVBQUU7QUFDNUIsSUFBQSxFQUFBLENBQUcsVUFBVSxXQUFXLENBQUE7QUFBQSxFQUM1QjtBQUVBLEVBQUEsSUFBSSxXQUFBLEtBQWdCLE1BQUEsRUFBVyxNQUFNLElBQUksTUFBTSw4Q0FBOEMsQ0FBQTtBQUU3RixFQUFBLGFBQUEsR0FBZ0IsQ0FBQSxFQUFHLFdBQVcsQ0FBQSxDQUFBLEVBQUksV0FBVyxDQUFBLENBQUE7QUFDN0MsRUFBQSxJQUFJLENBQUMsRUFBQSxDQUFHLFVBQUEsQ0FBVyxhQUFhLENBQUEsRUFBRTtBQUM5QixJQUFBLGFBQUEsQ0FBYyxTQUFBLEVBQVcsYUFBYSxDQUFBLENBQ2pDLElBQUEsQ0FBSyxNQUFNLE9BQUEsQ0FBUSxHQUFBLENBQUksZUFBZSxDQUFDLENBQUE7QUFBQSxFQUNoRDtBQUNKO0FBRUEsZUFBc0IsU0FBUyxnQkFBQSxFQUFnRTtBQUUzRixFQUFBLG9CQUFBLEdBQXVCLGdCQUFBLENBQWlCLFdBQUE7QUFDeEMsRUFBQSxPQUFBLENBQVEsSUFBSSwyQ0FBMkMsQ0FBQTtBQUN2RCxFQUFBLElBQUk7QUFDQSxJQUFBLE1BQU0sbUJBQW1CLG9CQUFvQixDQUFBO0FBQzdDLElBQUEsT0FBQSxDQUFRLEdBQUEsQ0FBSSxDQUFBLHdCQUFBLEVBQTJCLFdBQVcsQ0FBQSxJQUFBLENBQU0sQ0FBQTtBQUN4RCxJQUFBLE9BQUEsQ0FBUSxHQUFBLENBQUksQ0FBQSxZQUFBLEVBQWUscUJBQXFCLENBQUEsQ0FBRSxDQUFBO0FBRWxELElBQUEsTUFBTSxvQkFBQSxDQUFxQixnQkFBQSxDQUFpQixXQUFBLEVBQWEsb0JBQW9CLENBQUE7QUFFN0UsSUFBQSxPQUFBLENBQVEsSUFBSSxDQUFBLGtDQUFBLENBQW9DLENBQUE7QUFDaEQsSUFBQSxNQUFNLGVBQUEsRUFBZ0I7QUFFdEIsSUFBQSxPQUFBLENBQVEsSUFBSSxDQUFBLHNCQUFBLENBQXdCLENBQUE7QUFDcEMsSUFBQSxzQkFBQSxFQUF1QjtBQUFBLEVBQzNCLFNBQVMsS0FBQSxFQUFPO0FBQ1osSUFBQSxNQUFNLEdBQUEsR0FBTSxzQ0FBc0MsS0FBSyxDQUFBLENBQUE7QUFFdkQsSUFBQSxNQUFNRCx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxnQkFBQSxDQUFpQixHQUFHLENBQUE7QUFBQSxFQUVsRDtBQUdBLEVBQUEsTUFBTSxXQUFBLEdBQWNBLHVCQUFBLENBQWEsUUFBQSxDQUFTLGVBQUEsQ0FBZ0IsdUJBQXVCLFlBQVk7QUFDekYsSUFBQSxJQUF1QixDQUFDQSx1QkFBQSxDQUFhLEdBQUEsQ0FBSSxLQUFBLEVBQU87QUFDNUMsTUFBQSxNQUFNQSx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxnQkFBQSxDQUFpQixDQUFBLCtDQUFBLENBQWlELENBQUE7QUFDNUYsTUFBQTtBQUFBLElBQ0o7QUFFQSxJQUFBLElBQUksTUFBQTtBQUNKLElBQXVCO0FBRW5CLE1BQUEsTUFBQSxHQUFTLE1BQU1BLHVCQUFBLENBQWEsTUFBQSxDQUFPLGNBQWMsTUFBQSxDQUFPLElBQUEsQ0FBSyxpQkFBaUIsQ0FBQSxFQUFHO0FBQUEsUUFDN0UsS0FBQSxFQUFPLHlCQUFBO0FBQUEsUUFDUCxXQUFBLEVBQWE7QUFBQTtBQUFBLE9BQ2hCLENBQUE7QUFBQSxJQUNMO0FBSUEsSUFBQSxJQUFJLFdBQVcsTUFBQSxFQUFXO0FBQ3RCLE1BQUEsT0FBQSxDQUFRLElBQUksMkJBQTJCLENBQUE7QUFDdkMsTUFBQTtBQUFBLElBQ0o7QUFFQSxJQUFBLElBQUk7QUFDQSxNQUFBLGlCQUFBLENBQWtCLE1BQU0sQ0FBQSxFQUFFO0FBQUEsSUFDOUIsU0FBUyxLQUFBLEVBQU87QUFDWixNQUFBLE1BQU0sR0FBQSxHQUFNLENBQUEsYUFBQSxFQUFnQixNQUFBLENBQU8sS0FBSyxDQUFDLENBQUEsQ0FBQTtBQUN6QyxNQUFBLE9BQUEsQ0FBUSxNQUFNLEdBQUcsQ0FBQTtBQUNqQixNQUFBLE1BQU1BLHVCQUFBLENBQWEsTUFBQSxDQUFPLGdCQUFBLENBQWlCLEdBQUcsQ0FBQTtBQUU5QyxNQUFBLE1BQU0sR0FBQTtBQUFBLElBQ1Y7QUFBQSxFQUNKLENBQUMsQ0FBQTtBQUVELEVBQUEsSUFBSTtBQUdBLElBQUEsTUFBTSxPQUFPQSx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxtQkFBQSxDQUFvQkEsdUJBQUEsQ0FBYSxvQkFBb0IsR0FBRyxDQUFBO0FBQ3pGLElBQUEsSUFBQSxDQUFLLElBQUEsR0FBTyx3QkFBQTtBQUNaLElBQUEsSUFBQSxDQUFLLE9BQUEsR0FBVSxxQkFBQTtBQUNmLElBQUEsSUFBQSxDQUFLLElBQUEsRUFBSztBQUdWLElBQUEsZ0JBQUEsQ0FBaUIsYUFBQSxDQUFjLEtBQUssV0FBVyxDQUFBO0FBQy9DLElBQUEsZ0JBQUEsQ0FBaUIsYUFBQSxDQUFjLEtBQUssSUFBSSxDQUFBO0FBQUEsRUFDNUMsU0FBUyxLQUFBLEVBQU87QUFDWixJQUFBLE1BQU0sR0FBQSxHQUFNLHVEQUF1RCxLQUFLLENBQUEsQ0FBQTtBQUV4RSxJQUFBLE1BQU1BLHVCQUFBLENBQWEsTUFBQSxDQUFPLGdCQUFBLENBQWlCLEdBQUcsQ0FBQTtBQUM5QyxJQUFBLE1BQU0sSUFBSSxNQUFNLEdBQUcsQ0FBQTtBQUFBLEVBQ3ZCO0FBQ0o7QUFFQSxlQUFzQixVQUFBLEdBQTRCO0FBRWxEO0FBRUEsZUFBZSxnQ0FBQSxHQUFrRDtBQUM3RCxFQUFBLElBQUksYUFBQSxLQUFrQixNQUFBLEVBQVcsTUFBTSxJQUFJLE1BQU0sK0NBQStDLENBQUE7QUFFaEcsRUFBQSxNQUFNQSx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxzQkFBQSxDQUF1QixDQUFBLCtDQUFBLENBQWlELENBQUE7QUFFbEcsRUFBQSxJQUFJO0FBQ0EsSUFBQSxNQUFNLEVBQUUsTUFBQSxFQUFPLEdBQUksTUFBTUEsdUJBQUEsQ0FBYSxRQUFRLElBQUEsQ0FBSyxjQUFBLEVBQWdCLENBQUMsTUFBQSxFQUFRLEdBQUcsYUFBYSxDQUFBLHFDQUFBLENBQXVDLEdBQUcsRUFBQyxHQUFBLEVBQUssZUFBYyxDQUFBO0FBRTFKLElBQUEsTUFBTSxHQUFBLEdBQU0sK0RBQUE7QUFDWixJQUFBLE1BQU1BLHVCQUFBLENBQWEsTUFBQSxDQUFPLHNCQUFBLENBQXVCLEdBQUcsQ0FBQTtBQUNwRCxJQUFBLE9BQUEsQ0FBUSxJQUFJLEdBQUcsQ0FBQTtBQUFBLEVBQ25CLFNBQVMsS0FBQSxFQUFPO0FBQ1osSUFBQSxNQUFNLEdBQUEsR0FBTSw0REFBNEQsS0FBSyxDQUFBLENBQUE7QUFDN0UsSUFBQSxNQUFNQSx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxnQkFBQSxDQUFpQixHQUFHLENBQUE7QUFDOUMsSUFBQSxPQUFBLENBQVEsTUFBTSxHQUFHLENBQUE7QUFDakIsSUFBQSxNQUFNLElBQUksTUFBTSxHQUFHLENBQUE7QUFBQSxFQUN2QjtBQUNKO0FBRUEsZUFBZSxtQ0FBQSxHQUFxRDtBQUNoRSxFQUFBLE1BQU1BLHVCQUFBLENBQWEsTUFBQSxDQUFPLHNCQUFBLENBQXVCLENBQUEsc0RBQUEsQ0FBd0QsQ0FBQTtBQUV6RyxFQUFBLElBQUk7QUFDQSxJQUFBLE9BQUEsQ0FBUSxJQUFJLENBQUEsK0JBQUEsQ0FBaUMsQ0FBQTtBQUM3QyxJQUFBLE1BQU0sRUFBRSxNQUFBLEVBQU8sR0FBSSxNQUFNQSx1QkFBQSxDQUFhLE9BQUEsQ0FBUSxJQUFBLENBQUssUUFBQSxFQUFVLENBQUMsU0FBQSxFQUFXLE1BQU0sQ0FBQyxDQUFBO0FBQUEsRUFDcEYsU0FBUyxLQUFBLEVBQU87QUFDWixJQUFBLE1BQU1LLElBQUFBLEdBQU0sc0NBQXNDLEtBQUssQ0FBQSxDQUFBO0FBQ3ZELElBQUEsTUFBTUwsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUJLLElBQUcsQ0FBQTtBQUM5QyxJQUFBLE9BQUEsQ0FBUSxNQUFNQSxJQUFHLENBQUE7QUFDakIsSUFBQSxNQUFNLElBQUksTUFBTUEsSUFBRyxDQUFBO0FBQUEsRUFDdkI7QUFFQSxFQUFBLElBQUk7QUFDQSxJQUFBLE9BQUEsQ0FBUSxJQUFJLENBQUEsK0JBQUEsQ0FBaUMsQ0FBQTtBQUM3QyxJQUFBLE1BQU0sRUFBRSxNQUFBLEVBQU8sR0FBSSxNQUFNTCx1QkFBQSxDQUFhLE9BQUEsQ0FBUSxJQUFBLENBQUssUUFBQSxFQUFVLENBQUMsU0FBQSxFQUFXLE9BQU8sQ0FBQyxDQUFBO0FBQUEsRUFDckYsU0FBUyxLQUFBLEVBQU87QUFDWixJQUFBLE1BQU1LLElBQUFBLEdBQU0seUNBQXlDLEtBQUssQ0FBQSxDQUFBO0FBQzFELElBQUEsTUFBTUwsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUJLLElBQUcsQ0FBQTtBQUM5QyxJQUFBLE9BQUEsQ0FBUSxNQUFNQSxJQUFHLENBQUE7QUFDakIsSUFBQSxNQUFNLElBQUksTUFBTUEsSUFBRyxDQUFBO0FBQUEsRUFDdkI7QUFFQSxFQUFBLE1BQU0sR0FBQSxHQUFNLG9FQUFBO0FBQ1osRUFBQSxNQUFNTCx1QkFBQSxDQUFhLE1BQUEsQ0FBTyxzQkFBQSxDQUF1QixHQUFHLENBQUE7QUFDcEQsRUFBQSxPQUFBLENBQVEsTUFBTSxHQUFHLENBQUE7QUFDckI7QUFFQSxlQUFlLGVBQUEsR0FBaUM7QUFDNUMsRUFBQSxJQUFJLGFBQUEsS0FBa0IsTUFBQSxFQUFXLE1BQU0sSUFBSSxNQUFNLCtDQUErQyxDQUFBO0FBRWhHLEVBQUEsSUFBSSxFQUFBLENBQUcsVUFBQSxDQUFXLENBQUEsRUFBRyxhQUFhLGNBQWMsQ0FBQSxFQUFHO0FBQy9DLElBQUEsT0FBQSxDQUFRLElBQUksNEJBQTRCLENBQUE7QUFDeEMsSUFBQTtBQUFBLEVBQ0o7QUFFQSxFQUFBLE1BQU1BLHVCQUFBLENBQWEsTUFBQSxDQUFPLHNCQUFBLENBQXVCLENBQUEsbURBQUEsQ0FBcUQsQ0FBQTtBQUV0RyxFQUFBLElBQUk7QUFDQSxJQUFBLE1BQU0sRUFBRSxNQUFBLEVBQU8sR0FBSSxNQUFNQSx1QkFBQSxDQUFhLFFBQVEsSUFBQSxDQUFLLGNBQUEsRUFBZ0IsQ0FBQyxNQUFBLEVBQVEsR0FBRyxhQUFhLENBQUEsa0JBQUEsQ0FBb0IsR0FBRyxFQUFDLEdBQUEsRUFBSyxlQUFjLENBQUE7QUFBQSxFQUMzSSxTQUFTLEtBQUEsRUFBTztBQUNaLElBQUEsT0FBQSxDQUFRLE1BQU0sS0FBSyxDQUFBO0FBQ25CLElBQUEsTUFBTSxJQUFJLEtBQUEsQ0FBTSxDQUFBLHNDQUFBLEVBQXlDLEtBQUssQ0FBQSxFQUFBLEVBQUssS0FBQSxDQUFNLE1BQU0sQ0FBQSxDQUFFLENBQUE7QUFBQSxFQUNyRjtBQUNBLEVBQUEsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sc0JBQUEsQ0FBdUIsQ0FBQSwrQkFBQSxDQUFpQyxDQUFBO0FBRWxGLEVBQUEsT0FBQSxDQUFRLElBQUksaUNBQWlDLENBQUE7QUFDakQ7QUFFQSxlQUFlLHlCQUF5QixRQUFBLEVBQXlCO0FBQzdELEVBQUEsSUFBSTtBQUNBLElBQUEsTUFBTSxFQUFFLE1BQUEsRUFBTyxHQUFJLE1BQU1BLHVCQUFBLENBQWEsUUFBUSxJQUFBLENBQUssY0FBQSxFQUFnQixDQUFDLE1BQUEsRUFBUSxHQUFHLG9CQUFvQixDQUFBLCtCQUFBLENBQWlDLEdBQUcsRUFBQyxHQUFBLEVBQUssZUFBYyxDQUFBO0FBRTNKLElBQUEsTUFBTSxNQUFBLEdBQVMsTUFBQSxDQUFPLE9BQUEsQ0FBUSxLQUFBLEVBQU8sRUFBRSxDQUFBO0FBQ3ZDLElBQUEsTUFBTSxHQUFBLEdBQU0sQ0FBQTtBQUFBLEVBQXdDLE1BQU0sQ0FBQSxDQUFBO0FBQzFELElBQUEsSUFBSSxRQUFBLEVBQVU7QUFDVixNQUFBLE1BQU1BLHVCQUFBLENBQWEsTUFBQSxDQUFPLHNCQUFBLENBQXVCLEdBQUcsQ0FBQTtBQUFBLElBQ3hEO0FBQ0EsSUFBQSxPQUFBLENBQVEsSUFBSSxHQUFHLENBQUE7QUFFZixJQUFBLE9BQU8sQ0FBQTtBQUFBLEVBQ1gsU0FBUyxLQUFBLEVBQU87QUFFWixJQUFBLElBQUksR0FBQTtBQUNKLElBQUEsTUFBTSxNQUFBLEdBQVMsS0FBQSxDQUFNLE1BQUEsQ0FBTyxPQUFBLENBQVEsT0FBTyxFQUFFLENBQUE7QUFDN0MsSUFBQSxNQUFNLFdBQVcsS0FBQSxDQUFNLFFBQUE7QUFFdkIsSUFBQSxJQUFJLFFBQUEsR0FBVyxFQUFBLElBQU0sUUFBQSxHQUFXLEVBQUEsRUFBSTtBQUVoQyxNQUFBLEdBQUEsR0FBSyxDQUFBLHVCQUFBLEVBQTBCLE1BQU0sQ0FBQSxVQUFBLEVBQWEsUUFBUSxDQUFBLENBQUE7QUFDMUQsTUFBQSxJQUFJLFFBQUEsRUFBVTtBQUNWLFFBQUEsTUFBTUEsdUJBQUEsQ0FBYSxNQUFBLENBQU8sZ0JBQUEsQ0FBaUIsR0FBRyxDQUFBO0FBQUEsTUFDbEQ7QUFDQSxNQUFBLE9BQUEsQ0FBUSxLQUFLLEdBQUcsQ0FBQTtBQUNoQixNQUFBLE9BQU8sUUFBQTtBQUFBLElBQ1g7QUFHQSxJQUFBLEdBQUEsR0FBSyxDQUFBLHVDQUFBLEVBQTBDLE1BQU0sQ0FBQSxRQUFBLEVBQVcsUUFBUSxDQUFBLENBQUEsQ0FBQTtBQUN4RSxJQUFBLE1BQU1BLHVCQUFBLENBQWEsTUFBQSxDQUFPLGdCQUFBLENBQWlCLEdBQUcsQ0FBQTtBQUM5QyxJQUFBLE9BQUEsQ0FBUSxNQUFNLEdBQUcsQ0FBQTtBQUNqQixJQUFBLE1BQU0sSUFBSSxNQUFNLEdBQUcsQ0FBQTtBQUFBLEVBQ3ZCO0FBQ0o7Ozs7OzsifQ==
