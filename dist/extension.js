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
  "Check  PodMan Machine API Remoting status": () => checkPodmanMachineStatus()
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
    await extensionApi__namespace.window.showErrorMessage(`An API Remoting container ${containerId}  is already running. This version cannot have two containers running simultaneously.`);
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
    console.error(`Container creation failed :/ ${String(err2)}`);
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
  try {
    await initializeBuildDir(EXTENSION_BUILD_PATH);
    console.log(`Using image ${RamalamaRemotingImage}`);
    console.log(`Installing APIR version ${ApirVersion} ...`);
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
    const msg = "Podman machine successfully restart with the APIR libraries";
    await extensionApi__namespace.window.showInformationMessage(msg);
    console.log(msg);
  } catch (error) {
    const msg = "Failed to restart podman machine with the API libraries: ${error}";
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
async function checkPodmanMachineStatus() {
  try {
    const { stdout } = await extensionApi__namespace.process.exec("/usr/bin/env", ["bash", `${EXTENSION_BUILD_PATH}/check_podman_machine_status.sh`], { cwd: LocalBuildDir });
    const status = stdout.replace(/\n$/, "");
    const msg = `Podman Machine API Remoting status:
${status}`;
    await extensionApi__namespace.window.showInformationMessage(msg);
    console.log(msg);
  } catch (error) {
    console.error(error);
    let msg;
    const status = error.stdout.replace(/\n$/, "");
    const exitCode = error.exitCode;
    if (exitCode > 10 && exitCode < 20) {
      msg = `Podman Machine status: ${status} (code #${exitCode})`;
      await extensionApi__namespace.window.showInformationMessage(msg);
      return;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXh0ZW5zaW9uLmpzIiwic291cmNlcyI6WyIuLi9zcmMvZXh0ZW5zaW9uLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHtcbiAgICBDb250YWluZXJDcmVhdGVPcHRpb25zLFxuICAgIENvbnRhaW5lclByb3ZpZGVyQ29ubmVjdGlvbixcbiAgICBEZXZpY2VSZXF1ZXN0LFxuICAgIEltYWdlSW5mbyxcbiAgICBNb3VudENvbmZpZyxcbiAgICBQcm92aWRlckNvbnRhaW5lckNvbm5lY3Rpb24sXG59IGZyb20gJ0Bwb2RtYW4tZGVza3RvcC9hcGknO1xuXG5pbXBvcnQgKiBhcyBleHRlbnNpb25BcGkgZnJvbSAnQHBvZG1hbi1kZXNrdG9wL2FwaSc7XG5pbXBvcnQgdHlwZSB7IFBvZG1hbkNvbm5lY3Rpb24gfSBmcm9tICcuLi8uLi9tYW5hZ2Vycy9wb2RtYW5Db25uZWN0aW9uJztcbmltcG9ydCAqIGFzIFBvZG1hbkNvbm5lY3Rpb25BUEkgZnJvbSAnLi4vLi4vbWFuYWdlcnMvcG9kbWFuQ29ubmVjdGlvbic7XG5pbXBvcnQgeyBjb250YWluZXJFbmdpbmUsIHByb3ZpZGVyLCBQcm9ncmVzc0xvY2F0aW9uIH0gZnJvbSAnQHBvZG1hbi1kZXNrdG9wL2FwaSc7XG5cbmV4cG9ydCBjb25zdCBTRUNPTkQ6IG51bWJlciA9IDFfMDAwXzAwMF8wMDA7XG5cbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XG5jb25zdCBhc3luY19mcyA9IHJlcXVpcmUoJ2ZzL3Byb21pc2VzJyk7XG5cbmNvbnN0IEF2YWlsYWJsZU1vZGVscyA9IHt9O1xubGV0IEV4dGVuc2lvblN0b3JhZ2VQYXRoID0gdW5kZWZpbmVkO1xuXG5jb25zdCBGQUlMX0lGX05PVF9NQUMgPSBmYWxzZTtcbmNvbnN0IFNIT1dfSU5JVElBTF9NRU5VID0gdHJ1ZTtcbmNvbnN0IFNIT1dfTU9ERUxfU0VMRUNUX01FTlUgPSB0cnVlO1xuY29uc3QgRVhURU5TSU9OX0JVSUxEX1BBVEggPSBwYXRoLnBhcnNlKF9fZmlsZW5hbWUpLmRpciArIFwiLy4uL2J1aWxkXCI7XG5cbmNvbnN0IERFRkFVTFRfTU9ERUxfTkFNRSA9IFwiaWJtLWdyYW5pdGUvZ3Jhbml0ZS0zLjMtOGItaW5zdHJ1Y3QtR0dVRlwiOyAvLyBpZiBub3Qgc2hvd2luZyB0aGUgc2VsZWN0IG1lbnVcbmxldCBSYW1hbGFtYVJlbW90aW5nSW1hZ2UgPSB1bmRlZmluZWQ7XG5sZXQgQXBpclZlcnNpb24gPSB1bmRlZmluZWQ7XG5sZXQgTG9jYWxCdWlsZERpciA9IHVuZGVmaW5lZDtcblxuY29uc3QgTUFJTl9NRU5VX0NIT0lDRVMgPSB7XG4gICAgJ1Jlc3RhcnQgUG9kTWFuIE1hY2hpbmUgd2l0aCBBUEkgUmVtb3Rpbmcgc3VwcG9ydCc6ICgpID0+IHJlc3RhcnRfcG9kbWFuX21hY2hpbmVfd2l0aF9hcGlyKCksXG4gICAgJ1Jlc3RhcnQgUG9kTWFuIE1hY2hpbmUgd2l0aCB0aGUgZGVmYXVsdCBjb25maWd1cmF0aW9uJzogKCkgPT4gcmVzdGFydF9wb2RtYW5fbWFjaGluZV93aXRob3V0X2FwaXIoKSxcbiAgICAnTGF1bmNoIGFuIEFQSSBSZW1vdGluZyBhY2NlbGVyYXRlZCBJbmZlcmVuY2UgU2VydmVyJzogKCkgPT4gbGF1bmNoQXBpckluZmVyZW5jZVNlcnZlcigpLFxuICAgICdDaGVjayAgUG9kTWFuIE1hY2hpbmUgQVBJIFJlbW90aW5nIHN0YXR1cyc6ICgpID0+IGNoZWNrUG9kbWFuTWFjaGluZVN0YXR1cygpLFxufVxuXG5mdW5jdGlvbiByZWdpc3RlckZyb21EaXIoc3RhcnRQYXRoLCBmaWx0ZXIsIHJlZ2lzdGVyKSB7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKHN0YXJ0UGF0aCkpIHtcbiAgICAgICAgY29uc29sZS5sb2coXCJubyBkaXIgXCIsIHN0YXJ0UGF0aCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgZmlsZXMgPSBmcy5yZWFkZGlyU3luYyhzdGFydFBhdGgpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmlsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIGZpbGVuYW1lID0gcGF0aC5qb2luKHN0YXJ0UGF0aCwgZmlsZXNbaV0pO1xuICAgICAgICB2YXIgc3RhdCA9IGZzLmxzdGF0U3luYyhmaWxlbmFtZSk7XG4gICAgICAgIGlmIChzdGF0LmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIHJlZ2lzdGVyRnJvbURpcihmaWxlbmFtZSwgZmlsdGVyLCByZWdpc3Rlcik7IC8vcmVjdXJzZVxuICAgICAgICB9IGVsc2UgaWYgKGZpbGVuYW1lLmVuZHNXaXRoKGZpbHRlcikpIHtcbiAgICAgICAgICAgIHJlZ2lzdGVyKGZpbGVuYW1lKTtcbiAgICAgICAgfTtcbiAgICB9O1xufTtcblxuLy8gZ2VuZXJhdGVkIGJ5IGNoYXRncHRcbmFzeW5jIGZ1bmN0aW9uIGNvcHlSZWN1cnNpdmUoc3JjLCBkZXN0KSB7XG4gIGNvbnN0IGVudHJpZXMgPSBhd2FpdCBhc3luY19mcy5yZWFkZGlyKHNyYywgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuXG4gIGF3YWl0IGFzeW5jX2ZzLm1rZGlyKGRlc3QsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuXG4gIGZvciAobGV0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBjb25zdCBzcmNQYXRoID0gcGF0aC5qb2luKHNyYywgZW50cnkubmFtZSk7XG4gICAgY29uc3QgZGVzdFBhdGggPSBwYXRoLmpvaW4oZGVzdCwgZW50cnkubmFtZSk7XG5cbiAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgYXdhaXQgY29weVJlY3Vyc2l2ZShzcmNQYXRoLCBkZXN0UGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IGFzeW5jX2ZzLmNvcHlGaWxlKHNyY1BhdGgsIGRlc3RQYXRoKTtcbiAgICB9XG4gIH1cbn1cblxuY29uc3QgZ2V0UmFuZG9tU3RyaW5nID0gKCk6IHN0cmluZyA9PiB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBzb25hcmpzL3BzZXVkby1yYW5kb21cbiAgcmV0dXJuIChNYXRoLnJhbmRvbSgpICsgMSkudG9TdHJpbmcoMzYpLnN1YnN0cmluZyg3KTtcbn07XG5cbmZ1bmN0aW9uIHJlZnJlc2hBdmFpbGFibGVNb2RlbHMoKSB7XG4gICAgaWYgKEV4dGVuc2lvblN0b3JhZ2VQYXRoID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcignRXh0ZW5zaW9uU3RvcmFnZVBhdGggbm90IGRlZmluZWQgOi8nKTtcblxuICAgIC8vIGRlbGV0ZSB0aGUgZXhpc3RpbmcgbW9kZWxzXG4gICAgT2JqZWN0LmtleXMoQXZhaWxhYmxlTW9kZWxzKS5mb3JFYWNoKGtleSA9PiBkZWxldGUgQXZhaWxhYmxlTW9kZWxzW2tleV0pO1xuXG4gICAgY29uc3QgcmVnaXN0ZXJNb2RlbCA9IGZ1bmN0aW9uKGZpbGVuYW1lKSB7XG4gICAgICAgIGNvbnN0IGRpcl9uYW1lID0gZmlsZW5hbWUuc3BsaXQoXCIvXCIpLmF0KC0yKVxuICAgICAgICBjb25zdCBuYW1lX3BhcnRzID0gZGlyX25hbWUuc3BsaXQoXCIuXCIpXG4gICAgICAgIC8vIDAgaXMgdGhlIHNvdXJjZSAoZWcsIGhmKVxuICAgICAgICBjb25zdCBtb2RlbF9kaXIgPSBuYW1lX3BhcnRzLmF0KDEpXG4gICAgICAgIGNvbnN0IG1vZGVsX25hbWUgPSBuYW1lX3BhcnRzLnNsaWNlKDIpLmpvaW4oJy4nKVxuICAgICAgICBjb25zdCBtb2RlbF91c2VyX25hbWUgPSBgJHttb2RlbF9kaXJ9LyR7bW9kZWxfbmFtZX1gXG4gICAgICAgIEF2YWlsYWJsZU1vZGVsc1ttb2RlbF91c2VyX25hbWVdID0gZmlsZW5hbWU7XG4gICAgICAgIGNvbnNvbGUubG9nKGBmb3VuZCAke21vZGVsX3VzZXJfbmFtZX1gKVxuICAgIH1cblxuICAgIHJlZ2lzdGVyRnJvbURpcihFeHRlbnNpb25TdG9yYWdlUGF0aCArICcvLi4vcmVkaGF0LmFpLWxhYi9tb2RlbHMnLCAnLmdndWYnLCByZWdpc3Rlck1vZGVsKTtcbn1cblxuZnVuY3Rpb24gc2xlZXAobXMpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCBtcykpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBoYXNBcGlyQ29udGFpbmVyUnVubmluZygpIHtcbiAgICBjb25zdCBjb250YWluZXJJbmZvID1cbiAgICAgICAgICAoYXdhaXQgY29udGFpbmVyRW5naW5lLmxpc3RDb250YWluZXJzKCkpXG4gICAgICAgICAgLmZpbmQoY29udGFpbmVySW5mbyA9PiAoY29udGFpbmVySW5mby5MYWJlbHNbXCJsbGFtYS1jcHAuYXBpclwiXSA9PT0gXCJ0cnVlXCIgJiYgY29udGFpbmVySW5mby5TdGF0ZSA9PT0gXCJydW5uaW5nXCIpKTtcblxuICAgIHJldHVybiBjb250YWluZXJJbmZvPy5JZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbGF1bmNoQXBpckluZmVyZW5jZVNlcnZlcigpIHtcbiAgICBjb25zdCBjb250YWluZXJJZCA9IGF3YWl0IGhhc0FwaXJDb250YWluZXJSdW5uaW5nKCk7XG4gICAgaWYgKGNvbnRhaW5lcklkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkFQSSBSZW1vdGluZyBjb250YWluZXIgJHtjb250YWluZXJJZH0gYWxyZWFkeSBydW5uaW5nIC4uLlwiKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKGBBbiBBUEkgUmVtb3RpbmcgY29udGFpbmVyICR7Y29udGFpbmVySWR9ICBpcyBhbHJlYWR5IHJ1bm5pbmcuIFRoaXMgdmVyc2lvbiBjYW5ub3QgaGF2ZSB0d28gY29udGFpbmVycyBydW5uaW5nIHNpbXVsdGFuZW91c2x5LmApO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKFJhbWFsYW1hUmVtb3RpbmdJbWFnZSA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJSYW1hbGFtYSBSZW1vdGluZyBpbWFnZSBuYW1lIG5vdCBsb2FkZWQuIFRoaXMgaXMgdW5leHBlY3RlZC5cIik7XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoQXZhaWxhYmxlTW9kZWxzKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKFwiVGhlIGxpc3Qgb2YgbW9kZWxzIGlzIGVtcHR5LiBQbGVhc2UgZG93bmxvYWQgbW9kZWxzIHdpdGggUG9kbWFuIERlc2t0b3AgQUkgbGFiIGZpcnN0LlwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBsZXQgbW9kZWxfbmFtZTtcbiAgICBpZiAoU0hPV19NT0RFTF9TRUxFQ1RfTUVOVSkge1xuICAgICAgICByZWZyZXNoQXZhaWxhYmxlTW9kZWxzKCk7XG5cbiAgICAgICAgLy8gZGlzcGxheSBhIGNob2ljZSB0byB0aGUgdXNlciBmb3Igc2VsZWN0aW5nIHNvbWUgdmFsdWVzXG4gICAgICAgIG1vZGVsX25hbWUgPSBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dRdWlja1BpY2soT2JqZWN0LmtleXMoQXZhaWxhYmxlTW9kZWxzKSwge1xuICAgICAgICAgICAgY2FuUGlja01hbnk6IGZhbHNlLCAvLyB1c2VyIGNhbiBzZWxlY3QgbW9yZSB0aGFuIG9uZSBjaG9pY2VcbiAgICAgICAgICAgIHRpdGxlOiBcIkNob29zZSB0aGUgbW9kZWwgdG8gZGVwbG95XCIsXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAobW9kZWxfbmFtZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oJ05vIG1vZGVsIGNob3Nlbiwgbm90aGluZyB0byBsYXVuY2guJylcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgfSBlbHNlIHtcbiAgICAgICAgbW9kZWxfbmFtZSA9IERFRkFVTFRfTU9ERUxfTkFNRTtcbiAgICB9XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBwb3J0XG4gICAgbGV0IGhvc3RfcG9ydCA9IGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0lucHV0Qm94KHt0aXRsZTogXCJTZXJ2aWNlIHBvcnRcIiwgcHJvbXB0OiBcIkluZmVyZW5jZSBzZXJ2aWNlIHBvcnQgb24gdGhlIGhvc3RcIiwgdmFsdWU6IFwiMTIzNFwiLCB2YWxpZGF0ZUlucHV0OiAodmFsdWUpPT4gcGFyc2VJbnQodmFsdWUsIDEwKSA+IDEwMjQgPyBcIlwiOiBcIkVudGVyIGEgdmFsaWQgcG9ydCA+IDEwMjRcIn0pO1xuICAgIGhvc3RfcG9ydCA9IHBhcnNlSW50KGhvc3RfcG9ydCk7XG5cbiAgICBpZiAoaG9zdF9wb3J0ID09PSB1bmRlZmluZWQgfHwgTnVtYmVyLmlzTmFOKGhvc3RfcG9ydCkpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdObyBob3N0IHBvcnQgY2hvc2VuLCBub3RoaW5nIHRvIGxhdW5jaC4nKVxuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gcHVsbCB0aGUgaW1hZ2VcbiAgICBjb25zdCBpbWFnZUluZm86IEltYWdlSW5mbyA9IGF3YWl0IHB1bGxJbWFnZShcbiAgICAgICAgUmFtYWxhbWFSZW1vdGluZ0ltYWdlLFxuICAgICAgICB7fSxcbiAgICApO1xuXG5cbiAgICAvLyBnZXQgbW9kZWwgbW91bnQgc2V0dGluZ3NcbiAgICBjb25zdCBtb2RlbF9zcmMgPSBBdmFpbGFibGVNb2RlbHNbbW9kZWxfbmFtZV07XG4gICAgaWYgKG1vZGVsX3NyYyA9PT0gdW5kZWZpbmVkKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IGdldCB0aGUgZmlsZSBhc3NvY2lhdGVkIHdpdGggbW9kZWwgJHttb2RlbF9zcmN9LiBUaGlzIGlzIHVuZXhwZWN0ZWQuYCk7XG5cbiAgICBjb25zdCBtb2RlbF9maWxlbmFtZSA9IHBhdGguYmFzZW5hbWUobW9kZWxfc3JjKTtcbiAgICBjb25zdCBtb2RlbF9kaXJuYW1lID0gcGF0aC5iYXNlbmFtZShwYXRoLmRpcm5hbWUobW9kZWxfc3JjKSk7XG4gICAgY29uc3QgbW9kZWxfZGVzdCA9IGAvbW9kZWxzLyR7bW9kZWxfZmlsZW5hbWV9YDtcbiAgICBjb25zdCBhaV9sYWJfcG9ydCA9IDEwNDM0O1xuXG4gICAgLy8gcHJlcGFyZSB0aGUgbGFiZWxzXG4gICAgY29uc3QgbGFiZWxzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgICBbJ2FpLWxhYi1pbmZlcmVuY2Utc2VydmVyJ106IEpTT04uc3RyaW5naWZ5KFttb2RlbF9kaXJuYW1lXSksXG4gICAgICAgIFsnYXBpJ106IGBodHRwOi8vbG9jYWxob3N0OiR7aG9zdF9wb3J0fS92MWAsXG4gICAgICAgIFsnZG9jcyddOiBgaHR0cDovL2xvY2FsaG9zdDoke2FpX2xhYl9wb3J0fS9hcGktZG9jcy8ke2hvc3RfcG9ydH1gLFxuICAgICAgICBbJ2dwdSddOiBgbGxhbWEuY3BwIEFQSSBSZW1vdGluZ2AsXG4gICAgICAgIFtcInRyYWNraW5nSWRcIl06IGdldFJhbmRvbVN0cmluZygpLFxuICAgICAgICBbXCJsbGFtYS1jcHAuYXBpclwiXTogXCJ0cnVlXCIsXG4gICAgfTtcblxuICAgIC8vIHByZXBhcmUgdGhlIG1vdW50c1xuICAgIC8vIG1vdW50IHRoZSBmaWxlIGRpcmVjdG9yeSB0byBhdm9pZCBhZGRpbmcgb3RoZXIgZmlsZXMgdG8gdGhlIGNvbnRhaW5lcnNcbiAgICBjb25zdCBtb3VudHM6IE1vdW50Q29uZmlnID0gW1xuICAgICAge1xuICAgICAgICAgIFRhcmdldDogbW9kZWxfZGVzdCxcbiAgICAgICAgICBTb3VyY2U6IG1vZGVsX3NyYyxcbiAgICAgICAgICBUeXBlOiAnYmluZCcsXG4gICAgICB9LFxuICAgIF07XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBlbnRyeXBvaW50XG4gICAgbGV0IGVudHJ5cG9pbnQ6IHN0cmluZyB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcbiAgICBsZXQgY21kOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZW50cnlwb2ludCA9IFwiL3Vzci9iaW4vbGxhbWEtc2VydmVyLnNoXCI7XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBlbnZcbiAgICBjb25zdCBlbnZzOiBzdHJpbmdbXSA9IFtgTU9ERUxfUEFUSD0ke21vZGVsX2Rlc3R9YCwgJ0hPU1Q9MC4wLjAuMCcsICdQT1JUPTgwMDAnLCAnR1BVX0xBWUVSUz05OTknXTtcblxuICAgIC8vIHByZXBhcmUgdGhlIGRldmljZXNcbiAgICBjb25zdCBkZXZpY2VzOiBEZXZpY2VbXSA9IFtdO1xuICAgIGRldmljZXMucHVzaCh7XG4gICAgICAgIFBhdGhPbkhvc3Q6ICcvZGV2L2RyaScsXG4gICAgICAgIFBhdGhJbkNvbnRhaW5lcjogJy9kZXYvZHJpJyxcbiAgICAgICAgQ2dyb3VwUGVybWlzc2lvbnM6ICcnLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZGV2aWNlUmVxdWVzdHM6IERldmljZVJlcXVlc3RbXSA9IFtdO1xuICAgIGRldmljZVJlcXVlc3RzLnB1c2goe1xuICAgICAgICBDYXBhYmlsaXRpZXM6IFtbJ2dwdSddXSxcbiAgICAgICAgQ291bnQ6IC0xLCAvLyAtMTogYWxsXG4gICAgfSk7XG5cbiAgICAvLyBHZXQgdGhlIGNvbnRhaW5lciBjcmVhdGlvbiBvcHRpb25zXG4gICAgY29uc3QgY29udGFpbmVyQ3JlYXRlT3B0aW9uczogQ29udGFpbmVyQ3JlYXRlT3B0aW9ucyA9IHtcbiAgICAgICAgSW1hZ2U6IGltYWdlSW5mby5JZCxcbiAgICAgICAgRGV0YWNoOiB0cnVlLFxuICAgICAgICBFbnRyeXBvaW50OiBlbnRyeXBvaW50LFxuICAgICAgICBDbWQ6IGNtZCxcbiAgICAgICAgRXhwb3NlZFBvcnRzOiB7IFtgJHtob3N0X3BvcnR9YF06IHt9IH0sXG4gICAgICAgIEhvc3RDb25maWc6IHtcbiAgICAgICAgICAgIEF1dG9SZW1vdmU6IGZhbHNlLFxuICAgICAgICAgICAgRGV2aWNlczogZGV2aWNlcyxcbiAgICAgICAgICAgIE1vdW50czogbW91bnRzLFxuICAgICAgICAgICAgRGV2aWNlUmVxdWVzdHM6IGRldmljZVJlcXVlc3RzLFxuICAgICAgICAgICAgU2VjdXJpdHlPcHQ6IFtcImxhYmVsPWRpc2FibGVcIl0sXG4gICAgICAgICAgICBQb3J0QmluZGluZ3M6IHtcbiAgICAgICAgICAgICAgICAnODAwMC90Y3AnOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIEhvc3RQb3J0OiBgJHtob3N0X3BvcnR9YCxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSxcblxuICAgICAgICBIZWFsdGhDaGVjazoge1xuICAgICAgICAgIC8vIG11c3QgYmUgdGhlIHBvcnQgSU5TSURFIHRoZSBjb250YWluZXIgbm90IHRoZSBleHBvc2VkIG9uZVxuICAgICAgICAgIFRlc3Q6IFsnQ01ELVNIRUxMJywgYGN1cmwgLXNTZiBsb2NhbGhvc3Q6ODAwMCA+IC9kZXYvbnVsbGBdLFxuICAgICAgICAgIEludGVydmFsOiBTRUNPTkQgKiA1LFxuICAgICAgICAgIFJldHJpZXM6IDQgKiA1LFxuICAgICAgICAgIH0sXG4gICAgICAgIExhYmVsczogbGFiZWxzLFxuICAgICAgICBFbnY6IGVudnMsXG4gICAgfTtcbiAgICBjb25zb2xlLmxvZyhjb250YWluZXJDcmVhdGVPcHRpb25zLCBtb3VudHMpXG4gICAgLy8gQ3JlYXRlIHRoZSBjb250YWluZXJcbiAgICBjb25zdCB7IGVuZ2luZUlkLCBpZCB9ID0gYXdhaXQgY3JlYXRlQ29udGFpbmVyKGltYWdlSW5mby5lbmdpbmVJZCwgY29udGFpbmVyQ3JlYXRlT3B0aW9ucywgbGFiZWxzKTtcblxuICAgIC8vYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKGBDb250YWluZXIgaGFzIGJlZW4gbGF1bmNoZWQhICR7ZW5naW5lSWR9IHwgJHtpZH1gKTtcblxufVxuZXhwb3J0IHR5cGUgQmV0dGVyQ29udGFpbmVyQ3JlYXRlUmVzdWx0ID0gQ29udGFpbmVyQ3JlYXRlUmVzdWx0ICYgeyBlbmdpbmVJZDogc3RyaW5nIH07XG5cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUNvbnRhaW5lcihcbiAgICBlbmdpbmVJZDogc3RyaW5nLFxuICAgIGNvbnRhaW5lckNyZWF0ZU9wdGlvbnM6IENvbnRhaW5lckNyZWF0ZU9wdGlvbnMsXG4gICAgbGFiZWxzOiB7IFtpZDogc3RyaW5nXTogc3RyaW5nIH0sXG4pOiBQcm9taXNlPEJldHRlckNvbnRhaW5lckNyZWF0ZVJlc3VsdD4ge1xuXG4gICAgY29uc29sZS5sb2coXCJDcmVhdGluZyBjb250YWluZXIgLi4uXCIpO1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbnRhaW5lckVuZ2luZS5jcmVhdGVDb250YWluZXIoZW5naW5lSWQsIGNvbnRhaW5lckNyZWF0ZU9wdGlvbnMpO1xuICAgICAgICAvLyB1cGRhdGUgdGhlIHRhc2tcbiAgICAgICAgY29uc29sZS5sb2coXCJDb250YWluZXIgY3JlYXRlZCFcIik7XG5cbiAgICAgICAgLy8gcmV0dXJuIHRoZSBDb250YWluZXJDcmVhdGVSZXN1bHRcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGlkOiByZXN1bHQuaWQsXG4gICAgICAgICAgICBlbmdpbmVJZDogZW5naW5lSWQsXG4gICAgICAgIH07XG4gICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYENvbnRhaW5lciBjcmVhdGlvbiBmYWlsZWQgOi8gJHtTdHJpbmcoZXJyKX1gKTtcblxuICAgICAgICB0aHJvdyBlcnI7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBwdWxsSW1hZ2UoXG4gICAgaW1hZ2U6IHN0cmluZyxcbiAgICBsYWJlbHM6IHsgW2lkOiBzdHJpbmddOiBzdHJpbmcgfSxcbik6IFByb21pc2U8SW1hZ2VJbmZvPiB7XG4gICAgLy8gQ3JlYXRpbmcgYSB0YXNrIHRvIGZvbGxvdyBwdWxsaW5nIHByb2dyZXNzXG4gICAgY29uc29sZS5sb2coYFB1bGxpbmcgdGhlIGltYWdlICR7aW1hZ2V9IC4uLmApXG5cbiAgICBjb25zdCBwcm92aWRlcnM6IFByb3ZpZGVyQ29udGFpbmVyQ29ubmVjdGlvbltdID0gcHJvdmlkZXIuZ2V0Q29udGFpbmVyQ29ubmVjdGlvbnMoKTtcbiAgICBjb25zdCBwb2RtYW5Qcm92aWRlciA9IHByb3ZpZGVyc1xuICAgICAgICAgIC5maWx0ZXIoKHsgY29ubmVjdGlvbiB9KSA9PiBjb25uZWN0aW9uLnR5cGUgPT09ICdwb2RtYW4nKTtcbiAgICBpZiAoIXBvZG1hblByb3ZpZGVyKSB0aHJvdyBuZXcgRXJyb3IoYGNhbm5vdCBmaW5kIHBvZG1hbiBwcm92aWRlcmApO1xuXG4gICAgbGV0IGNvbm5lY3Rpb246IENvbnRhaW5lclByb3ZpZGVyQ29ubmVjdGlvbiA9IHBvZG1hblByb3ZpZGVyWzBdLmNvbm5lY3Rpb247XG5cbiAgICAvLyBnZXQgdGhlIGRlZmF1bHQgaW1hZ2UgaW5mbyBmb3IgdGhpcyBwcm92aWRlclxuICAgIHJldHVybiBnZXRJbWFnZUluZm8oY29ubmVjdGlvbiwgaW1hZ2UsIChfZXZlbnQ6IFB1bGxFdmVudCkgPT4ge30pXG4gICAgICAgIC5jYXRjaCgoZXJyOiB1bmtub3duKSA9PiB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBTb21ldGhpbmcgd2VudCB3cm9uZyB3aGlsZSBwdWxsaW5nICR7aW1hZ2V9OiAke1N0cmluZyhlcnIpfWApO1xuICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9KVxuICAgICAgICAudGhlbihpbWFnZUluZm8gPT4ge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJJbWFnZSBwdWxsZWQgc3VjY2Vzc2Z1bGx5XCIpO1xuICAgICAgICAgICAgcmV0dXJuIGltYWdlSW5mbztcbiAgICAgICAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEltYWdlSW5mbyhcbiAgY29ubmVjdGlvbjogQ29udGFpbmVyUHJvdmlkZXJDb25uZWN0aW9uLFxuICBpbWFnZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGV2ZW50OiBQdWxsRXZlbnQpID0+IHZvaWQsXG4pOiBQcm9taXNlPEltYWdlSW5mbz4ge1xuICAgIGxldCBpbWFnZUluZm8gPSB1bmRlZmluZWQ7XG5cbiAgICB0cnkge1xuICAgICAgICAvLyBQdWxsIGltYWdlXG4gICAgICAgIGF3YWl0IGNvbnRhaW5lckVuZ2luZS5wdWxsSW1hZ2UoY29ubmVjdGlvbiwgaW1hZ2UsIGNhbGxiYWNrKTtcblxuICAgICAgICAvLyBHZXQgaW1hZ2UgaW5zcGVjdFxuICAgICAgICBpbWFnZUluZm8gPSAoXG4gICAgICAgICAgICBhd2FpdCBjb250YWluZXJFbmdpbmUubGlzdEltYWdlcyh7XG4gICAgICAgICAgICAgICAgcHJvdmlkZXI6IGNvbm5lY3Rpb24sXG4gICAgICAgICAgICB9IGFzIExpc3RJbWFnZXNPcHRpb25zKVxuICAgICAgICApLmZpbmQoaW1hZ2VJbmZvID0+IGltYWdlSW5mby5SZXBvVGFncz8uc29tZSh0YWcgPT4gdGFnID09PSBpbWFnZSkpO1xuXG4gICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignU29tZXRoaW5nIHdlbnQgd3Jvbmcgd2hpbGUgdHJ5aW5nIHRvIGdldCBpbWFnZSBpbnNwZWN0JywgZXJyKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKGBTb21ldGhpbmcgd2VudCB3cm9uZyB3aGlsZSB0cnlpbmcgdG8gZ2V0IGltYWdlIGluc3BlY3Q6ICR7ZXJyfWApO1xuXG4gICAgICAgIHRocm93IGVycjtcbiAgICB9XG5cbiAgICBpZiAoaW1hZ2VJbmZvID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihgaW1hZ2UgJHtpbWFnZX0gbm90IGZvdW5kLmApO1xuXG4gICAgcmV0dXJuIGltYWdlSW5mbztcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5pdGlhbGl6ZUJ1aWxkRGlyKGJ1aWxkUGF0aCkge1xuICAgIGNvbnNvbGUubG9nKGBJbml0aWFsaXppbmcgdGhlIGJ1aWxkIGRpcmVjdG9yeSBmcm9tICR7YnVpbGRQYXRofSAuLi5gKVxuXG4gICAgQXBpclZlcnNpb24gPSAoYXdhaXQgYXN5bmNfZnMucmVhZEZpbGUoYnVpbGRQYXRoICsgJy9zcmNfaW5mby92ZXJzaW9uLnR4dCcsICd1dGY4JykpLnJlcGxhY2UoL1xcbiQvLCBcIlwiKTtcblxuICAgIGlmIChSYW1hbGFtYVJlbW90aW5nSW1hZ2UgPT09IHVuZGVmaW5lZClcbiAgICAgICAgUmFtYWxhbWFSZW1vdGluZ0ltYWdlID0gKGF3YWl0IGFzeW5jX2ZzLnJlYWRGaWxlKGJ1aWxkUGF0aCArICcvc3JjX2luZm8vcmFtYWxhbWEuaW1hZ2UtaW5mby50eHQnLCAndXRmOCcpKS5yZXBsYWNlKC9cXG4kLywgXCJcIik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGluaXRpYWxpemVTdG9yYWdlRGlyKHN0b3JhZ2VQYXRoLCBidWlsZFBhdGgpIHtcbiAgICBjb25zb2xlLmxvZyhgSW5pdGlhbGl6aW5nIHRoZSBzdG9yYWdlIGRpcmVjdG9yeSAuLi5gKVxuXG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKHN0b3JhZ2VQYXRoKSl7XG4gICAgICAgIGZzLm1rZGlyU3luYyhzdG9yYWdlUGF0aCk7XG4gICAgfVxuXG4gICAgaWYgKEFwaXJWZXJzaW9uID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkFQSVIgdmVyc2lvbiBub3QgbG9hZGVkLiBUaGlzIGlzIHVuZXhwZWN0ZWQuXCIpO1xuXG4gICAgTG9jYWxCdWlsZERpciA9IGAke3N0b3JhZ2VQYXRofS8ke0FwaXJWZXJzaW9ufWA7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKExvY2FsQnVpbGREaXIpKXtcbiAgICAgICAgY29weVJlY3Vyc2l2ZShidWlsZFBhdGgsIExvY2FsQnVpbGREaXIpXG4gICAgICAgICAgICAudGhlbigoKSA9PiBjb25zb2xlLmxvZygnQ29weSBjb21wbGV0ZScpKTtcbiAgICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhY3RpdmF0ZShleHRlbnNpb25Db250ZXh0OiBleHRlbnNpb25BcGkuRXh0ZW5zaW9uQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIGluaXRpYWxpemUgdGhlIGdsb2JhbCB2YXJpYWJsZXMgLi4uXG4gICAgRXh0ZW5zaW9uU3RvcmFnZVBhdGggPSBleHRlbnNpb25Db250ZXh0LnN0b3JhZ2VQYXRoO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgaW5pdGlhbGl6ZUJ1aWxkRGlyKEVYVEVOU0lPTl9CVUlMRF9QQVRIKTtcbiAgICAgICAgY29uc29sZS5sb2coYFVzaW5nIGltYWdlICR7UmFtYWxhbWFSZW1vdGluZ0ltYWdlfWApO1xuICAgICAgICBjb25zb2xlLmxvZyhgSW5zdGFsbGluZyBBUElSIHZlcnNpb24gJHtBcGlyVmVyc2lvbn0gLi4uYCk7XG5cbiAgICAgICAgYXdhaXQgaW5pdGlhbGl6ZVN0b3JhZ2VEaXIoZXh0ZW5zaW9uQ29udGV4dC5zdG9yYWdlUGF0aCwgRVhURU5TSU9OX0JVSUxEX1BBVEgpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGBQcmVwYXJpbmcgdGhlIGtydW5raXQgYmluYXJpZXMgLi4uYCk7XG4gICAgICAgIGF3YWl0IHByZXBhcmVfa3J1bmtpdCgpO1xuXG4gICAgICAgIGNvbnNvbGUubG9nKGBMb2FkaW5nIHRoZSBtb2RlbHMgLi4uYCk7XG4gICAgICAgIHJlZnJlc2hBdmFpbGFibGVNb2RlbHMoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBtc2cgPSBgQ291bGRuJ3QgaW5pdGlhbGl6ZSB0aGUgZXh0ZW5zaW9uOiAke2Vycm9yfWBcblxuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgLy8gdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxuXG4gICAgLy8gcmVnaXN0ZXIgdGhlIGNvbW1hbmQgcmVmZXJlbmNlZCBpbiBwYWNrYWdlLmpzb24gZmlsZVxuICAgIGNvbnN0IG1lbnVDb21tYW5kID0gZXh0ZW5zaW9uQXBpLmNvbW1hbmRzLnJlZ2lzdGVyQ29tbWFuZCgnbGxhbWEuY3BwLmFwaXIubWVudScsIGFzeW5jICgpID0+IHtcbiAgICAgICAgaWYgKEZBSUxfSUZfTk9UX01BQyAmJiAhZXh0ZW5zaW9uQXBpLmVudi5pc01hYykge1xuICAgICAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKGBsbGFtYS5jcHAgQVBJIFJlbW90aW5nIG9ubHkgc3VwcG9ydGVkIG9uIE1hY09TLmApO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgbGV0IHJlc3VsdDtcbiAgICAgICAgaWYgKFNIT1dfSU5JVElBTF9NRU5VKSB7XG4gICAgICAgICAgICAvLyBkaXNwbGF5IGEgY2hvaWNlIHRvIHRoZSB1c2VyIGZvciBzZWxlY3Rpbmcgc29tZSB2YWx1ZXNcbiAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd1F1aWNrUGljayhPYmplY3Qua2V5cyhNQUlOX01FTlVfQ0hPSUNFUyksIHtcbiAgICAgICAgICAgICAgICB0aXRsZTogXCJXaGF0IGRvIHlvdSB3YW50IHRvIGRvP1wiLFxuICAgICAgICAgICAgICAgIGNhblBpY2tNYW55OiBmYWxzZSwgLy8gdXNlciBjYW4gc2VsZWN0IG1vcmUgdGhhbiBvbmUgY2hvaWNlXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJlc3VsdCA9IE1BSU5fTUVOVV9DSE9JQ0VTWzJdO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHJlc3VsdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIk5vIHVzZXIgY2hvaWNlLCBhYm9ydGluZy5cIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0cnkge1xuICAgICAgICAgICAgTUFJTl9NRU5VX0NIT0lDRVNbcmVzdWx0XSgpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgY29uc3QgbXNnID0gYFRhc2sgZmFpbGVkOiAke1N0cmluZyhlcnJvcil9YDtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbiAgICAgICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuXG4gICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIHRyeSB7XG4gICAgICAgIC8vIGNyZWF0ZSBhbiBpdGVtIGluIHRoZSBzdGF0dXMgYmFyIHRvIHJ1biBvdXIgY29tbWFuZFxuICAgICAgICAvLyBpdCB3aWxsIHN0aWNrIG9uIHRoZSBsZWZ0IG9mIHRoZSBzdGF0dXMgYmFyXG4gICAgICAgIGNvbnN0IGl0ZW0gPSBleHRlbnNpb25BcGkud2luZG93LmNyZWF0ZVN0YXR1c0Jhckl0ZW0oZXh0ZW5zaW9uQXBpLlN0YXR1c0JhckFsaWduTGVmdCwgMTAwKTtcbiAgICAgICAgaXRlbS50ZXh0ID0gJ0xsYW1hLmNwcCBBUEkgUmVtb3RpbmcnO1xuICAgICAgICBpdGVtLmNvbW1hbmQgPSAnbGxhbWEuY3BwLmFwaXIubWVudSc7XG4gICAgICAgIGl0ZW0uc2hvdygpO1xuXG4gICAgICAgIC8vIHJlZ2lzdGVyIGRpc3Bvc2FibGUgcmVzb3VyY2VzIHRvIGl0J3MgcmVtb3ZlZCB3aGVuIHlvdSBkZWFjdGl2dGUgdGhlIGV4dGVuc2lvblxuICAgICAgICBleHRlbnNpb25Db250ZXh0LnN1YnNjcmlwdGlvbnMucHVzaChtZW51Q29tbWFuZCk7XG4gICAgICAgIGV4dGVuc2lvbkNvbnRleHQuc3Vic2NyaXB0aW9ucy5wdXNoKGl0ZW0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBDb3VsZG4ndCBzdWJzY3JpYmUgdGhlIGV4dGVuc2lvbiB0byBQb2RtYW4gRGVza3RvcDogJHtlcnJvcn1gXG5cbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlYWN0aXZhdGUoKTogUHJvbWlzZTx2b2lkPiB7XG5cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzdGFydF9wb2RtYW5fbWFjaGluZV93aXRoX2FwaXIoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKExvY2FsQnVpbGREaXIgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWxCdWlsZERpciBub3QgbG9hZGVkLiBUaGlzIGlzIHVuZXhwZWN0ZWQuXCIpO1xuXG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKGBSZXN0YXJ0aW5nIFBvZG1hbiBtYWNoaW5lIHdpdGggQVBJUiBzdXBwb3J0IC4uLmApO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4dGVuc2lvbkFwaS5wcm9jZXNzLmV4ZWMoXCIvdXNyL2Jpbi9lbnZcIiwgW1wiYmFzaFwiLCBgJHtMb2NhbEJ1aWxkRGlyfS9wb2RtYW5fc3RhcnRfbWFjaGluZS5hcGlfcmVtb3Rpbmcuc2hgXSwge2N3ZDogTG9jYWxCdWlsZERpcn0pO1xuXG4gICAgICAgIGNvbnN0IG1zZyA9IFwiUG9kbWFuIG1hY2hpbmUgc3VjY2Vzc2Z1bGx5IHJlc3RhcnQgd2l0aCB0aGUgQVBJUiBsaWJyYXJpZXNcIlxuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UobXNnKTtcbiAgICAgICAgY29uc29sZS5sb2cobXNnKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBtc2cgPSBcIkZhaWxlZCB0byByZXN0YXJ0IHBvZG1hbiBtYWNoaW5lIHdpdGggdGhlIEFQSSBsaWJyYXJpZXM6ICR7ZXJyb3J9XCJcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXN0YXJ0X3BvZG1hbl9tYWNoaW5lX3dpdGhvdXRfYXBpcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UoYFJlc3RhcnRpbmcgUG9kbWFuIG1hY2hpbmUgd2l0aG91dCBBUEkgUmVtb3Rpbmcgc3VwcG9ydGApO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc29sZS5sb2coYFN0b3BwaW5nIHRoZSBQb2RNYW4gTWFjaGluZSAuLi5gKTtcbiAgICAgICAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4dGVuc2lvbkFwaS5wcm9jZXNzLmV4ZWMoXCJwb2RtYW5cIiwgWydtYWNoaW5lJywgJ3N0b3AnXSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgbXNnID0gYEZhaWxlZCB0byBzdG9wIHRoZSBQb2RNYW4gTWFjaGluZTogJHtlcnJvcn1gO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmxvZyhgU3RhcnRpbmcgdGhlIFBvZE1hbiBNYWNoaW5lIC4uLmApO1xuICAgICAgICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLnByb2Nlc3MuZXhlYyhcInBvZG1hblwiLCBbJ21hY2hpbmUnLCAnc3RhcnQnXSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgbXNnID0gYEZhaWxlZCB0byByZXN0YXJ0IHRoZSBQb2RNYW4gTWFjaGluZTogJHtlcnJvcn1gO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG5cbiAgICBjb25zdCBtc2cgPSBcIlBvZE1hbiBNYWNoaW5lIHN1Y2Nlc3NmdWxseSByZXN0YXJ0ZWQgd2l0aG91dCBBUEkgUmVtb3Rpbmcgc3VwcG9ydFwiO1xuICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShtc2cpO1xuICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcHJlcGFyZV9rcnVua2l0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChMb2NhbEJ1aWxkRGlyID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsQnVpbGREaXIgbm90IGxvYWRlZC4gVGhpcyBpcyB1bmV4cGVjdGVkLlwiKTtcblxuICAgIGlmIChmcy5leGlzdHNTeW5jKGAke0xvY2FsQnVpbGREaXJ9L2Jpbi9rcnVua2l0YCkpIHtcbiAgICAgICAgY29uc29sZS5sb2coXCJCaW5hcmllcyBhbHJlYWR5IHByZXBhcmVkLlwiKVxuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKGBQcmVwYXJpbmcgdGhlIGtydW5raXQgYmluYXJpZXMgZm9yIEFQSSBSZW1vdGluZyAuLi5gKTtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleHRlbnNpb25BcGkucHJvY2Vzcy5leGVjKFwiL3Vzci9iaW4vZW52XCIsIFtcImJhc2hcIiwgYCR7TG9jYWxCdWlsZERpcn0vdXBkYXRlX2tydW5raXQuc2hgXSwge2N3ZDogTG9jYWxCdWlsZERpcn0pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IHVwZGF0ZSB0aGUga3J1bmtpdCBiaW5hcmllczogJHtlcnJvcn06ICR7ZXJyb3Iuc3Rkb3V0fWApO1xuICAgIH1cbiAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UoYEJpbmFyaWVzIHN1Y2Nlc3NmdWxseSBwcmVwYXJlZCFgKTtcblxuICAgIGNvbnNvbGUubG9nKFwiQmluYXJpZXMgc3VjY2Vzc2Z1bGx5IHByZXBhcmVkIVwiKVxufVxuXG5hc3luYyBmdW5jdGlvbiBjaGVja1BvZG1hbk1hY2hpbmVTdGF0dXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4dGVuc2lvbkFwaS5wcm9jZXNzLmV4ZWMoXCIvdXNyL2Jpbi9lbnZcIiwgW1wiYmFzaFwiLCBgJHtFWFRFTlNJT05fQlVJTERfUEFUSH0vY2hlY2tfcG9kbWFuX21hY2hpbmVfc3RhdHVzLnNoYF0sIHtjd2Q6IExvY2FsQnVpbGREaXJ9KTtcbiAgICAgICAgLy8gZXhpdCB3aXRoIHN1Y2Nlc3MsIGtydW5raXQgaXMgcnVubmluZyBBUEkgcmVtb3RpbmdcbiAgICAgICAgY29uc3Qgc3RhdHVzID0gc3Rkb3V0LnJlcGxhY2UoL1xcbiQvLCBcIlwiKVxuICAgICAgICBjb25zdCBtc2cgPSBgUG9kbWFuIE1hY2hpbmUgQVBJIFJlbW90aW5nIHN0YXR1czpcXG4ke3N0YXR1c31gXG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShtc2cpO1xuICAgICAgICBjb25zb2xlLmxvZyhtc2cpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoZXJyb3IpO1xuICAgICAgICBsZXQgbXNnO1xuICAgICAgICBjb25zdCBzdGF0dXMgPSBlcnJvci5zdGRvdXQucmVwbGFjZSgvXFxuJC8sIFwiXCIpXG4gICAgICAgIGNvbnN0IGV4aXRDb2RlID0gZXJyb3IuZXhpdENvZGU7XG5cbiAgICAgICAgaWYgKGV4aXRDb2RlID4gMTAgJiYgZXhpdENvZGUgPCAyMCkge1xuICAgICAgICAgICAgLy8gZXhpdCB3aXRoIGNvZGUgMXggPT0+IHN1Y2Nlc3NmdWwgY29tcGxldGlvbiwgYnV0IG5vdCBBUEkgUmVtb3Rpbmcgc3VwcG9ydFxuICAgICAgICAgICAgbXNnID1gUG9kbWFuIE1hY2hpbmUgc3RhdHVzOiAke3N0YXR1c30gKGNvZGUgIyR7ZXhpdENvZGV9KWA7XG4gICAgICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UobXNnKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIG90aGVyIGV4aXQgY29kZSBjcmFzaCBvZiB1bnN1Y2Nlc3NmdWwgY29tcGxldGlvblxuICAgICAgICBtc2cgPWBGYWlsZWQgdG8gY2hlY2sgUG9kTWFuIE1hY2hpbmUgc3RhdHVzOiAke3N0YXR1c30gKGNvZGUgIyR7ZXhpdENvZGV9KWA7XG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cbn1cbiJdLCJuYW1lcyI6WyJjb250YWluZXJFbmdpbmUiLCJjb250YWluZXJJbmZvIiwiZXh0ZW5zaW9uQXBpIiwiZXJyIiwicHJvdmlkZXIiLCJjb25uZWN0aW9uIiwiaW1hZ2VJbmZvIiwibXNnIl0sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBY08sTUFBTSxNQUFBLEdBQWlCO0FBRTlCLE1BQU0sSUFBQSxHQUFPLFFBQVEsTUFBTSxDQUFBO0FBQzNCLE1BQU0sRUFBQSxHQUFLLFFBQVEsSUFBSSxDQUFBO0FBQ3ZCLE1BQU0sUUFBQSxHQUFXLFFBQVEsYUFBYSxDQUFBO0FBRXRDLE1BQU0sa0JBQWtCLEVBQUM7QUFDekIsSUFBSSxvQkFBQSxHQUF1QixNQUFBO0FBSzNCLE1BQU0sb0JBQUEsR0FBdUIsSUFBQSxDQUFLLEtBQUEsQ0FBTSxVQUFVLEVBQUUsR0FBQSxHQUFNLFdBQUE7QUFHMUQsSUFBSSxxQkFBQSxHQUF3QixNQUFBO0FBQzVCLElBQUksV0FBQSxHQUFjLE1BQUE7QUFDbEIsSUFBSSxhQUFBLEdBQWdCLE1BQUE7QUFFcEIsTUFBTSxpQkFBQSxHQUFvQjtBQUFBLEVBQ3RCLGtEQUFBLEVBQW9ELE1BQU0sZ0NBQUEsRUFBaUM7QUFBQSxFQUMzRix1REFBQSxFQUF5RCxNQUFNLG1DQUFBLEVBQW9DO0FBQUEsRUFDbkcscURBQUEsRUFBdUQsTUFBTSx5QkFBQSxFQUEwQjtBQUFBLEVBQ3ZGLDJDQUFBLEVBQTZDLE1BQU0sd0JBQUE7QUFDdkQsQ0FBQTtBQUVBLFNBQVMsZUFBQSxDQUFnQixTQUFBLEVBQVcsTUFBQSxFQUFRLFFBQUEsRUFBVTtBQUNsRCxFQUFBLElBQUksQ0FBQyxFQUFBLENBQUcsVUFBQSxDQUFXLFNBQVMsQ0FBQSxFQUFHO0FBQzNCLElBQUEsT0FBQSxDQUFRLEdBQUEsQ0FBSSxXQUFXLFNBQVMsQ0FBQTtBQUNoQyxJQUFBO0FBQUEsRUFDSjtBQUVBLEVBQUEsSUFBSSxLQUFBLEdBQVEsRUFBQSxDQUFHLFdBQUEsQ0FBWSxTQUFTLENBQUE7QUFDcEMsRUFBQSxLQUFBLElBQVMsQ0FBQSxHQUFJLENBQUEs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
