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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXh0ZW5zaW9uLmpzIiwic291cmNlcyI6WyIuLi9zcmMvZXh0ZW5zaW9uLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHtcbiAgICBDb250YWluZXJDcmVhdGVPcHRpb25zLFxuICAgIENvbnRhaW5lclByb3ZpZGVyQ29ubmVjdGlvbixcbiAgICBEZXZpY2VSZXF1ZXN0LFxuICAgIEltYWdlSW5mbyxcbiAgICBNb3VudENvbmZpZyxcbiAgICBQcm92aWRlckNvbnRhaW5lckNvbm5lY3Rpb24sXG59IGZyb20gJ0Bwb2RtYW4tZGVza3RvcC9hcGknO1xuXG5pbXBvcnQgKiBhcyBleHRlbnNpb25BcGkgZnJvbSAnQHBvZG1hbi1kZXNrdG9wL2FwaSc7XG5pbXBvcnQgdHlwZSB7IFBvZG1hbkNvbm5lY3Rpb24gfSBmcm9tICcuLi8uLi9tYW5hZ2Vycy9wb2RtYW5Db25uZWN0aW9uJztcbmltcG9ydCAqIGFzIFBvZG1hbkNvbm5lY3Rpb25BUEkgZnJvbSAnLi4vLi4vbWFuYWdlcnMvcG9kbWFuQ29ubmVjdGlvbic7XG5pbXBvcnQgeyBjb250YWluZXJFbmdpbmUsIHByb3ZpZGVyLCBQcm9ncmVzc0xvY2F0aW9uIH0gZnJvbSAnQHBvZG1hbi1kZXNrdG9wL2FwaSc7XG5cbmV4cG9ydCBjb25zdCBTRUNPTkQ6IG51bWJlciA9IDFfMDAwXzAwMF8wMDA7XG5cbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XG5jb25zdCBhc3luY19mcyA9IHJlcXVpcmUoJ2ZzL3Byb21pc2VzJyk7XG5cbmNvbnN0IEF2YWlsYWJsZU1vZGVscyA9IHt9O1xubGV0IEV4dGVuc2lvblN0b3JhZ2VQYXRoID0gdW5kZWZpbmVkO1xuXG5jb25zdCBGQUlMX0lGX05PVF9NQUMgPSBmYWxzZTtcbmNvbnN0IFNIT1dfSU5JVElBTF9NRU5VID0gdHJ1ZTtcbmNvbnN0IFNIT1dfTU9ERUxfU0VMRUNUX01FTlUgPSB0cnVlO1xuY29uc3QgRVhURU5TSU9OX0JVSUxEX1BBVEggPSBwYXRoLnBhcnNlKF9fZmlsZW5hbWUpLmRpciArIFwiLy4uL2J1aWxkXCI7XG5cbmNvbnN0IERFRkFVTFRfTU9ERUxfTkFNRSA9IFwiaWJtLWdyYW5pdGUvZ3Jhbml0ZS0zLjMtOGItaW5zdHJ1Y3QtR0dVRlwiOyAvLyBpZiBub3Qgc2hvd2luZyB0aGUgc2VsZWN0IG1lbnVcbmxldCBSYW1hbGFtYVJlbW90aW5nSW1hZ2UgPSB1bmRlZmluZWQ7XG5sZXQgQXBpclZlcnNpb24gPSB1bmRlZmluZWQ7XG5sZXQgTG9jYWxCdWlsZERpciA9IHVuZGVmaW5lZDtcblxuY29uc3QgTUFJTl9NRU5VX0NIT0lDRVMgPSB7XG4gICAgJ1Jlc3RhcnQgUG9kTWFuIE1hY2hpbmUgd2l0aCBBUEkgUmVtb3Rpbmcgc3VwcG9ydCc6ICgpID0+IHJlc3RhcnRfcG9kbWFuX21hY2hpbmVfd2l0aF9hcGlyKCksXG4gICAgJ1Jlc3RhcnQgUG9kTWFuIE1hY2hpbmUgd2l0aCB0aGUgZGVmYXVsdCBjb25maWd1cmF0aW9uJzogKCkgPT4gcmVzdGFydF9wb2RtYW5fbWFjaGluZV93aXRob3V0X2FwaXIoKSxcbiAgICAnTGF1bmNoIGFuIEFQSSBSZW1vdGluZyBhY2NlbGVyYXRlZCBJbmZlcmVuY2UgU2VydmVyJzogKCkgPT4gbGF1bmNoQXBpckluZmVyZW5jZVNlcnZlcigpLFxuICAgICdDaGVjayAgUG9kTWFuIE1hY2hpbmUgQVBJIFJlbW90aW5nIHN0YXR1cyc6ICgpID0+IGNoZWNrUG9kbWFuTWFjaGluZVN0YXR1cygpLFxufVxuXG5mdW5jdGlvbiByZWdpc3RlckZyb21EaXIoc3RhcnRQYXRoLCBmaWx0ZXIsIHJlZ2lzdGVyKSB7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKHN0YXJ0UGF0aCkpIHtcbiAgICAgICAgY29uc29sZS5sb2coXCJubyBkaXIgXCIsIHN0YXJ0UGF0aCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgZmlsZXMgPSBmcy5yZWFkZGlyU3luYyhzdGFydFBhdGgpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmlsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIGZpbGVuYW1lID0gcGF0aC5qb2luKHN0YXJ0UGF0aCwgZmlsZXNbaV0pO1xuICAgICAgICB2YXIgc3RhdCA9IGZzLmxzdGF0U3luYyhmaWxlbmFtZSk7XG4gICAgICAgIGlmIChzdGF0LmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIHJlZ2lzdGVyRnJvbURpcihmaWxlbmFtZSwgZmlsdGVyLCByZWdpc3Rlcik7IC8vcmVjdXJzZVxuICAgICAgICB9IGVsc2UgaWYgKGZpbGVuYW1lLmVuZHNXaXRoKGZpbHRlcikpIHtcbiAgICAgICAgICAgIHJlZ2lzdGVyKGZpbGVuYW1lKTtcbiAgICAgICAgfTtcbiAgICB9O1xufTtcblxuLy8gZ2VuZXJhdGVkIGJ5IGNoYXRncHRcbmFzeW5jIGZ1bmN0aW9uIGNvcHlSZWN1cnNpdmUoc3JjLCBkZXN0KSB7XG4gIGNvbnN0IGVudHJpZXMgPSBhd2FpdCBhc3luY19mcy5yZWFkZGlyKHNyYywgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuXG4gIGF3YWl0IGFzeW5jX2ZzLm1rZGlyKGRlc3QsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuXG4gIGZvciAobGV0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBjb25zdCBzcmNQYXRoID0gcGF0aC5qb2luKHNyYywgZW50cnkubmFtZSk7XG4gICAgY29uc3QgZGVzdFBhdGggPSBwYXRoLmpvaW4oZGVzdCwgZW50cnkubmFtZSk7XG5cbiAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgYXdhaXQgY29weVJlY3Vyc2l2ZShzcmNQYXRoLCBkZXN0UGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IGFzeW5jX2ZzLmNvcHlGaWxlKHNyY1BhdGgsIGRlc3RQYXRoKTtcbiAgICB9XG4gIH1cbn1cblxuY29uc3QgZ2V0UmFuZG9tU3RyaW5nID0gKCk6IHN0cmluZyA9PiB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBzb25hcmpzL3BzZXVkby1yYW5kb21cbiAgcmV0dXJuIChNYXRoLnJhbmRvbSgpICsgMSkudG9TdHJpbmcoMzYpLnN1YnN0cmluZyg3KTtcbn07XG5cbmZ1bmN0aW9uIHJlZnJlc2hBdmFpbGFibGVNb2RlbHMoKSB7XG4gICAgaWYgKEV4dGVuc2lvblN0b3JhZ2VQYXRoID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcignRXh0ZW5zaW9uU3RvcmFnZVBhdGggbm90IGRlZmluZWQgOi8nKTtcblxuICAgIC8vIGRlbGV0ZSB0aGUgZXhpc3RpbmcgbW9kZWxzXG4gICAgT2JqZWN0LmtleXMoQXZhaWxhYmxlTW9kZWxzKS5mb3JFYWNoKGtleSA9PiBkZWxldGUgQXZhaWxhYmxlTW9kZWxzW2tleV0pO1xuXG4gICAgY29uc3QgcmVnaXN0ZXJNb2RlbCA9IGZ1bmN0aW9uKGZpbGVuYW1lKSB7XG4gICAgICAgIGNvbnN0IGRpcl9uYW1lID0gZmlsZW5hbWUuc3BsaXQoXCIvXCIpLmF0KC0yKVxuICAgICAgICBjb25zdCBuYW1lX3BhcnRzID0gZGlyX25hbWUuc3BsaXQoXCIuXCIpXG4gICAgICAgIC8vIDAgaXMgdGhlIHNvdXJjZSAoZWcsIGhmKVxuICAgICAgICBjb25zdCBtb2RlbF9kaXIgPSBuYW1lX3BhcnRzLmF0KDEpXG4gICAgICAgIGNvbnN0IG1vZGVsX25hbWUgPSBuYW1lX3BhcnRzLnNsaWNlKDIpLmpvaW4oJy4nKVxuICAgICAgICBjb25zdCBtb2RlbF91c2VyX25hbWUgPSBgJHttb2RlbF9kaXJ9LyR7bW9kZWxfbmFtZX1gXG4gICAgICAgIEF2YWlsYWJsZU1vZGVsc1ttb2RlbF91c2VyX25hbWVdID0gZmlsZW5hbWU7XG4gICAgICAgIGNvbnNvbGUubG9nKGBmb3VuZCAke21vZGVsX3VzZXJfbmFtZX1gKVxuICAgIH1cblxuICAgIHJlZ2lzdGVyRnJvbURpcihFeHRlbnNpb25TdG9yYWdlUGF0aCArICcvLi4vcmVkaGF0LmFpLWxhYi9tb2RlbHMnLCAnLmdndWYnLCByZWdpc3Rlck1vZGVsKTtcbn1cblxuZnVuY3Rpb24gc2xlZXAobXMpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCBtcykpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBoYXNBcGlyQ29udGFpbmVyUnVubmluZygpIHtcbiAgICBjb25zdCBjb250YWluZXJJbmZvID1cbiAgICAgICAgICAoYXdhaXQgY29udGFpbmVyRW5naW5lLmxpc3RDb250YWluZXJzKCkpXG4gICAgICAgICAgLmZpbmQoY29udGFpbmVySW5mbyA9PiAoY29udGFpbmVySW5mby5MYWJlbHNbXCJsbGFtYS1jcHAuYXBpclwiXSA9PT0gXCJ0cnVlXCIgJiYgY29udGFpbmVySW5mby5TdGF0ZSA9PT0gXCJydW5uaW5nXCIpKTtcblxuICAgIHJldHVybiBjb250YWluZXJJbmZvPy5JZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbGF1bmNoQXBpckluZmVyZW5jZVNlcnZlcigpIHtcbiAgICBjb25zdCBjb250YWluZXJJZCA9IGF3YWl0IGhhc0FwaXJDb250YWluZXJSdW5uaW5nKCk7XG4gICAgaWYgKGNvbnRhaW5lcklkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkFQSSBSZW1vdGluZyBjb250YWluZXIgJHtjb250YWluZXJJZH0gYWxyZWFkeSBydW5uaW5nIC4uLlwiKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKGBBbiBBUEkgUmVtb3RpbmcgY29udGFpbmVyICR7Y29udGFpbmVySWR9ICBpcyBhbHJlYWR5IHJ1bm5pbmcuIFRoaXMgdmVyc2lvbiBjYW5ub3QgaGF2ZSB0d28gY29udGFpbmVycyBydW5uaW5nIHNpbXVsdGFuZW91c2x5LmApO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKFJhbWFsYW1hUmVtb3RpbmdJbWFnZSA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJSYW1hbGFtYSBSZW1vdGluZyBpbWFnZSBuYW1lIG5vdCBsb2FkZWQuIFRoaXMgaXMgdW5leHBlY3RlZC5cIik7XG5cbiAgICBpZiAoT2JqZWN0LmtleXMoQXZhaWxhYmxlTW9kZWxzKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKFwiVGhlIGxpc3Qgb2YgbW9kZWxzIGlzIGVtcHR5LiBQbGVhc2UgZG93bmxvYWQgbW9kZWxzIHdpdGggUG9kbWFuIERlc2t0b3AgQUkgbGFiIGZpcnN0LlwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBsZXQgbW9kZWxfbmFtZTtcbiAgICBpZiAoU0hPV19NT0RFTF9TRUxFQ1RfTUVOVSkge1xuICAgICAgICByZWZyZXNoQXZhaWxhYmxlTW9kZWxzKCk7XG5cbiAgICAgICAgLy8gZGlzcGxheSBhIGNob2ljZSB0byB0aGUgdXNlciBmb3Igc2VsZWN0aW5nIHNvbWUgdmFsdWVzXG4gICAgICAgIG1vZGVsX25hbWUgPSBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dRdWlja1BpY2soT2JqZWN0LmtleXMoQXZhaWxhYmxlTW9kZWxzKSwge1xuICAgICAgICAgICAgY2FuUGlja01hbnk6IGZhbHNlLCAvLyB1c2VyIGNhbiBzZWxlY3QgbW9yZSB0aGFuIG9uZSBjaG9pY2VcbiAgICAgICAgICAgIHRpdGxlOiBcIkNob29zZSB0aGUgbW9kZWwgdG8gZGVwbG95XCIsXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAobW9kZWxfbmFtZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBjb25zb2xlLndhcm4oJ05vIG1vZGVsIGNob3Nlbiwgbm90aGluZyB0byBsYXVuY2guJylcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgfSBlbHNlIHtcbiAgICAgICAgbW9kZWxfbmFtZSA9IERFRkFVTFRfTU9ERUxfTkFNRTtcbiAgICB9XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBwb3J0XG4gICAgbGV0IGhvc3RfcG9ydCA9IGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0lucHV0Qm94KHt0aXRsZTogXCJTZXJ2aWNlIHBvcnRcIiwgcHJvbXB0OiBcIkluZmVyZW5jZSBzZXJ2aWNlIHBvcnQgb24gdGhlIGhvc3RcIiwgdmFsdWU6IFwiMTIzNFwiLCB2YWxpZGF0ZUlucHV0OiAodmFsdWUpPT4gcGFyc2VJbnQodmFsdWUsIDEwKSA+IDEwMjQgPyBcIlwiOiBcIkVudGVyIGEgdmFsaWQgcG9ydCA+IDEwMjRcIn0pO1xuICAgIGhvc3RfcG9ydCA9IHBhcnNlSW50KGhvc3RfcG9ydCk7XG5cbiAgICBpZiAoaG9zdF9wb3J0ID09PSB1bmRlZmluZWQgfHwgTnVtYmVyLmlzTmFOKGhvc3RfcG9ydCkpIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdObyBob3N0IHBvcnQgY2hvc2VuLCBub3RoaW5nIHRvIGxhdW5jaC4nKVxuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gcHVsbCB0aGUgaW1hZ2VcbiAgICBjb25zdCBpbWFnZUluZm86IEltYWdlSW5mbyA9IGF3YWl0IHB1bGxJbWFnZShcbiAgICAgICAgUmFtYWxhbWFSZW1vdGluZ0ltYWdlLFxuICAgICAgICB7fSxcbiAgICApO1xuXG5cbiAgICAvLyBnZXQgbW9kZWwgbW91bnQgc2V0dGluZ3NcbiAgICBjb25zdCBtb2RlbF9zcmMgPSBBdmFpbGFibGVNb2RlbHNbbW9kZWxfbmFtZV07XG4gICAgaWYgKG1vZGVsX3NyYyA9PT0gdW5kZWZpbmVkKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IGdldCB0aGUgZmlsZSBhc3NvY2lhdGVkIHdpdGggbW9kZWwgJHttb2RlbF9zcmN9LiBUaGlzIGlzIHVuZXhwZWN0ZWQuYCk7XG5cbiAgICBjb25zdCBtb2RlbF9maWxlbmFtZSA9IHBhdGguYmFzZW5hbWUobW9kZWxfc3JjKTtcbiAgICBjb25zdCBtb2RlbF9kaXJuYW1lID0gcGF0aC5iYXNlbmFtZShwYXRoLmRpcm5hbWUobW9kZWxfc3JjKSk7XG4gICAgY29uc3QgbW9kZWxfZGVzdCA9IGAvbW9kZWxzLyR7bW9kZWxfZmlsZW5hbWV9YDtcbiAgICBjb25zdCBhaV9sYWJfcG9ydCA9IDEwNDM0O1xuXG4gICAgLy8gcHJlcGFyZSB0aGUgbGFiZWxzXG4gICAgY29uc3QgbGFiZWxzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgICBbJ2FpLWxhYi1pbmZlcmVuY2Utc2VydmVyJ106IEpTT04uc3RyaW5naWZ5KFttb2RlbF9kaXJuYW1lXSksXG4gICAgICAgIFsnYXBpJ106IGBodHRwOi8vbG9jYWxob3N0OiR7aG9zdF9wb3J0fS92MWAsXG4gICAgICAgIFsnZG9jcyddOiBgaHR0cDovL2xvY2FsaG9zdDoke2FpX2xhYl9wb3J0fS9hcGktZG9jcy8ke2hvc3RfcG9ydH1gLFxuICAgICAgICBbJ2dwdSddOiBgbGxhbWEuY3BwIEFQSSBSZW1vdGluZ2AsXG4gICAgICAgIFtcInRyYWNraW5nSWRcIl06IGdldFJhbmRvbVN0cmluZygpLFxuICAgICAgICBbXCJsbGFtYS1jcHAuYXBpclwiXTogXCJ0cnVlXCIsXG4gICAgfTtcblxuICAgIC8vIHByZXBhcmUgdGhlIG1vdW50c1xuICAgIC8vIG1vdW50IHRoZSBmaWxlIGRpcmVjdG9yeSB0byBhdm9pZCBhZGRpbmcgb3RoZXIgZmlsZXMgdG8gdGhlIGNvbnRhaW5lcnNcbiAgICBjb25zdCBtb3VudHM6IE1vdW50Q29uZmlnID0gW1xuICAgICAge1xuICAgICAgICAgIFRhcmdldDogbW9kZWxfZGVzdCxcbiAgICAgICAgICBTb3VyY2U6IG1vZGVsX3NyYyxcbiAgICAgICAgICBUeXBlOiAnYmluZCcsXG4gICAgICB9LFxuICAgIF07XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBlbnRyeXBvaW50XG4gICAgbGV0IGVudHJ5cG9pbnQ6IHN0cmluZyB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcbiAgICBsZXQgY21kOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZW50cnlwb2ludCA9IFwiL3Vzci9iaW4vbGxhbWEtc2VydmVyLnNoXCI7XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBlbnZcbiAgICBjb25zdCBlbnZzOiBzdHJpbmdbXSA9IFtgTU9ERUxfUEFUSD0ke21vZGVsX2Rlc3R9YCwgJ0hPU1Q9MC4wLjAuMCcsICdQT1JUPTgwMDAnLCAnR1BVX0xBWUVSUz05OTknXTtcblxuICAgIC8vIHByZXBhcmUgdGhlIGRldmljZXNcbiAgICBjb25zdCBkZXZpY2VzOiBEZXZpY2VbXSA9IFtdO1xuICAgIGRldmljZXMucHVzaCh7XG4gICAgICAgIFBhdGhPbkhvc3Q6ICcvZGV2L2RyaScsXG4gICAgICAgIFBhdGhJbkNvbnRhaW5lcjogJy9kZXYvZHJpJyxcbiAgICAgICAgQ2dyb3VwUGVybWlzc2lvbnM6ICcnLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZGV2aWNlUmVxdWVzdHM6IERldmljZVJlcXVlc3RbXSA9IFtdO1xuICAgIGRldmljZVJlcXVlc3RzLnB1c2goe1xuICAgICAgICBDYXBhYmlsaXRpZXM6IFtbJ2dwdSddXSxcbiAgICAgICAgQ291bnQ6IC0xLCAvLyAtMTogYWxsXG4gICAgfSk7XG5cbiAgICAvLyBHZXQgdGhlIGNvbnRhaW5lciBjcmVhdGlvbiBvcHRpb25zXG4gICAgY29uc3QgY29udGFpbmVyQ3JlYXRlT3B0aW9uczogQ29udGFpbmVyQ3JlYXRlT3B0aW9ucyA9IHtcbiAgICAgICAgSW1hZ2U6IGltYWdlSW5mby5JZCxcbiAgICAgICAgRGV0YWNoOiB0cnVlLFxuICAgICAgICBFbnRyeXBvaW50OiBlbnRyeXBvaW50LFxuICAgICAgICBDbWQ6IGNtZCxcbiAgICAgICAgRXhwb3NlZFBvcnRzOiB7IFtgJHtob3N0X3BvcnR9YF06IHt9IH0sXG4gICAgICAgIEhvc3RDb25maWc6IHtcbiAgICAgICAgICAgIEF1dG9SZW1vdmU6IGZhbHNlLFxuICAgICAgICAgICAgRGV2aWNlczogZGV2aWNlcyxcbiAgICAgICAgICAgIE1vdW50czogbW91bnRzLFxuICAgICAgICAgICAgRGV2aWNlUmVxdWVzdHM6IGRldmljZVJlcXVlc3RzLFxuICAgICAgICAgICAgU2VjdXJpdHlPcHQ6IFtcImxhYmVsPWRpc2FibGVcIl0sXG4gICAgICAgICAgICBQb3J0QmluZGluZ3M6IHtcbiAgICAgICAgICAgICAgICAnODAwMC90Y3AnOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIEhvc3RQb3J0OiBgJHtob3N0X3BvcnR9YCxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSxcblxuICAgICAgICBIZWFsdGhDaGVjazoge1xuICAgICAgICAgIC8vIG11c3QgYmUgdGhlIHBvcnQgSU5TSURFIHRoZSBjb250YWluZXIgbm90IHRoZSBleHBvc2VkIG9uZVxuICAgICAgICAgIFRlc3Q6IFsnQ01ELVNIRUxMJywgYGN1cmwgLXNTZiBsb2NhbGhvc3Q6ODAwMCA+IC9kZXYvbnVsbGBdLFxuICAgICAgICAgIEludGVydmFsOiBTRUNPTkQgKiA1LFxuICAgICAgICAgIFJldHJpZXM6IDQgKiA1LFxuICAgICAgICAgIH0sXG4gICAgICAgIExhYmVsczogbGFiZWxzLFxuICAgICAgICBFbnY6IGVudnMsXG4gICAgfTtcbiAgICBjb25zb2xlLmxvZyhjb250YWluZXJDcmVhdGVPcHRpb25zLCBtb3VudHMpXG4gICAgLy8gQ3JlYXRlIHRoZSBjb250YWluZXJcbiAgICBjb25zdCB7IGVuZ2luZUlkLCBpZCB9ID0gYXdhaXQgY3JlYXRlQ29udGFpbmVyKGltYWdlSW5mby5lbmdpbmVJZCwgY29udGFpbmVyQ3JlYXRlT3B0aW9ucywgbGFiZWxzKTtcblxuICAgIC8vYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKGBDb250YWluZXIgaGFzIGJlZW4gbGF1bmNoZWQhICR7ZW5naW5lSWR9IHwgJHtpZH1gKTtcblxufVxuZXhwb3J0IHR5cGUgQmV0dGVyQ29udGFpbmVyQ3JlYXRlUmVzdWx0ID0gQ29udGFpbmVyQ3JlYXRlUmVzdWx0ICYgeyBlbmdpbmVJZDogc3RyaW5nIH07XG5cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUNvbnRhaW5lcihcbiAgICBlbmdpbmVJZDogc3RyaW5nLFxuICAgIGNvbnRhaW5lckNyZWF0ZU9wdGlvbnM6IENvbnRhaW5lckNyZWF0ZU9wdGlvbnMsXG4gICAgbGFiZWxzOiB7IFtpZDogc3RyaW5nXTogc3RyaW5nIH0sXG4pOiBQcm9taXNlPEJldHRlckNvbnRhaW5lckNyZWF0ZVJlc3VsdD4ge1xuXG4gICAgY29uc29sZS5sb2coXCJDcmVhdGluZyBjb250YWluZXIgLi4uXCIpO1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbnRhaW5lckVuZ2luZS5jcmVhdGVDb250YWluZXIoZW5naW5lSWQsIGNvbnRhaW5lckNyZWF0ZU9wdGlvbnMpO1xuICAgICAgICAvLyB1cGRhdGUgdGhlIHRhc2tcbiAgICAgICAgY29uc29sZS5sb2coXCJDb250YWluZXIgY3JlYXRlZCFcIik7XG5cbiAgICAgICAgLy8gcmV0dXJuIHRoZSBDb250YWluZXJDcmVhdGVSZXN1bHRcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGlkOiByZXN1bHQuaWQsXG4gICAgICAgICAgICBlbmdpbmVJZDogZW5naW5lSWQsXG4gICAgICAgIH07XG4gICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYENvbnRhaW5lciBjcmVhdGlvbiBmYWlsZWQgOi8gJHtTdHJpbmcoZXJyKX1gKTtcblxuICAgICAgICB0aHJvdyBlcnI7XG4gICAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBwdWxsSW1hZ2UoXG4gICAgaW1hZ2U6IHN0cmluZyxcbiAgICBsYWJlbHM6IHsgW2lkOiBzdHJpbmddOiBzdHJpbmcgfSxcbik6IFByb21pc2U8SW1hZ2VJbmZvPiB7XG4gICAgLy8gQ3JlYXRpbmcgYSB0YXNrIHRvIGZvbGxvdyBwdWxsaW5nIHByb2dyZXNzXG4gICAgY29uc29sZS5sb2coYFB1bGxpbmcgdGhlIGltYWdlICR7aW1hZ2V9IC4uLmApXG5cbiAgICBjb25zdCBwcm92aWRlcnM6IFByb3ZpZGVyQ29udGFpbmVyQ29ubmVjdGlvbltdID0gcHJvdmlkZXIuZ2V0Q29udGFpbmVyQ29ubmVjdGlvbnMoKTtcbiAgICBjb25zdCBwb2RtYW5Qcm92aWRlciA9IHByb3ZpZGVyc1xuICAgICAgICAgIC5maWx0ZXIoKHsgY29ubmVjdGlvbiB9KSA9PiBjb25uZWN0aW9uLnR5cGUgPT09ICdwb2RtYW4nKTtcbiAgICBpZiAoIXBvZG1hblByb3ZpZGVyKSB0aHJvdyBuZXcgRXJyb3IoYGNhbm5vdCBmaW5kIHBvZG1hbiBwcm92aWRlcmApO1xuXG4gICAgbGV0IGNvbm5lY3Rpb246IENvbnRhaW5lclByb3ZpZGVyQ29ubmVjdGlvbiA9IHBvZG1hblByb3ZpZGVyWzBdLmNvbm5lY3Rpb247XG5cbiAgICAvLyBnZXQgdGhlIGRlZmF1bHQgaW1hZ2UgaW5mbyBmb3IgdGhpcyBwcm92aWRlclxuICAgIHJldHVybiBnZXRJbWFnZUluZm8oY29ubmVjdGlvbiwgaW1hZ2UsIChfZXZlbnQ6IFB1bGxFdmVudCkgPT4ge30pXG4gICAgICAgIC5jYXRjaCgoZXJyOiB1bmtub3duKSA9PiB7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBTb21ldGhpbmcgd2VudCB3cm9uZyB3aGlsZSBwdWxsaW5nICR7aW1hZ2V9OiAke1N0cmluZyhlcnIpfWApO1xuICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9KVxuICAgICAgICAudGhlbihpbWFnZUluZm8gPT4ge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJJbWFnZSBwdWxsZWQgc3VjY2Vzc2Z1bGx5XCIpO1xuICAgICAgICAgICAgcmV0dXJuIGltYWdlSW5mbztcbiAgICAgICAgfSk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdldEltYWdlSW5mbyhcbiAgY29ubmVjdGlvbjogQ29udGFpbmVyUHJvdmlkZXJDb25uZWN0aW9uLFxuICBpbWFnZTogc3RyaW5nLFxuICBjYWxsYmFjazogKGV2ZW50OiBQdWxsRXZlbnQpID0+IHZvaWQsXG4pOiBQcm9taXNlPEltYWdlSW5mbz4ge1xuICAgIGxldCBpbWFnZUluZm8gPSB1bmRlZmluZWQ7XG5cbiAgICB0cnkge1xuICAgICAgICAvLyBQdWxsIGltYWdlXG4gICAgICAgIGF3YWl0IGNvbnRhaW5lckVuZ2luZS5wdWxsSW1hZ2UoY29ubmVjdGlvbiwgaW1hZ2UsIGNhbGxiYWNrKTtcblxuICAgICAgICAvLyBHZXQgaW1hZ2UgaW5zcGVjdFxuICAgICAgICBpbWFnZUluZm8gPSAoXG4gICAgICAgICAgICBhd2FpdCBjb250YWluZXJFbmdpbmUubGlzdEltYWdlcyh7XG4gICAgICAgICAgICAgICAgcHJvdmlkZXI6IGNvbm5lY3Rpb24sXG4gICAgICAgICAgICB9IGFzIExpc3RJbWFnZXNPcHRpb25zKVxuICAgICAgICApLmZpbmQoaW1hZ2VJbmZvID0+IGltYWdlSW5mby5SZXBvVGFncz8uc29tZSh0YWcgPT4gdGFnID09PSBpbWFnZSkpO1xuXG4gICAgfSBjYXRjaCAoZXJyOiB1bmtub3duKSB7XG4gICAgICAgIGNvbnNvbGUud2FybignU29tZXRoaW5nIHdlbnQgd3Jvbmcgd2hpbGUgdHJ5aW5nIHRvIGdldCBpbWFnZSBpbnNwZWN0JywgZXJyKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKGBTb21ldGhpbmcgd2VudCB3cm9uZyB3aGlsZSB0cnlpbmcgdG8gZ2V0IGltYWdlIGluc3BlY3Q6ICR7ZXJyfWApO1xuXG4gICAgICAgIHRocm93IGVycjtcbiAgICB9XG5cbiAgICBpZiAoaW1hZ2VJbmZvID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihgaW1hZ2UgJHtpbWFnZX0gbm90IGZvdW5kLmApO1xuXG4gICAgcmV0dXJuIGltYWdlSW5mbztcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5pdGlhbGl6ZUJ1aWxkRGlyKGJ1aWxkUGF0aCkge1xuICAgIGNvbnNvbGUubG9nKGBJbml0aWFsaXppbmcgdGhlIGJ1aWxkIGRpcmVjdG9yeSBmcm9tICR7YnVpbGRQYXRofSAuLi5gKVxuXG4gICAgQXBpclZlcnNpb24gPSAoYXdhaXQgYXN5bmNfZnMucmVhZEZpbGUoYnVpbGRQYXRoICsgJy9zcmNfaW5mby92ZXJzaW9uLnR4dCcsICd1dGY4JykpLnJlcGxhY2UoL1xcbiQvLCBcIlwiKTtcblxuICAgIGlmIChSYW1hbGFtYVJlbW90aW5nSW1hZ2UgPT09IHVuZGVmaW5lZClcbiAgICAgICAgUmFtYWxhbWFSZW1vdGluZ0ltYWdlID0gKGF3YWl0IGFzeW5jX2ZzLnJlYWRGaWxlKGJ1aWxkUGF0aCArICcvc3JjX2luZm8vcmFtYWxhbWEuaW1hZ2UtaW5mby50eHQnLCAndXRmOCcpKS5yZXBsYWNlKC9cXG4kLywgXCJcIik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGluaXRpYWxpemVTdG9yYWdlRGlyKHN0b3JhZ2VQYXRoLCBidWlsZFBhdGgpIHtcbiAgICBjb25zb2xlLmxvZyhgSW5pdGlhbGl6aW5nIHRoZSBzdG9yYWdlIGRpcmVjdG9yeSAuLi5gKVxuXG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKHN0b3JhZ2VQYXRoKSl7XG4gICAgICAgIGZzLm1rZGlyU3luYyhzdG9yYWdlUGF0aCk7XG4gICAgfVxuXG4gICAgaWYgKEFwaXJWZXJzaW9uID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkFQSVIgdmVyc2lvbiBub3QgbG9hZGVkLiBUaGlzIGlzIHVuZXhwZWN0ZWQuXCIpO1xuXG4gICAgTG9jYWxCdWlsZERpciA9IGAke3N0b3JhZ2VQYXRofS8ke0FwaXJWZXJzaW9ufWA7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKExvY2FsQnVpbGREaXIpKXtcbiAgICAgICAgY29weVJlY3Vyc2l2ZShidWlsZFBhdGgsIExvY2FsQnVpbGREaXIpXG4gICAgICAgICAgICAudGhlbigoKSA9PiBjb25zb2xlLmxvZygnQ29weSBjb21wbGV0ZScpKTtcbiAgICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhY3RpdmF0ZShleHRlbnNpb25Db250ZXh0OiBleHRlbnNpb25BcGkuRXh0ZW5zaW9uQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIGluaXRpYWxpemUgdGhlIGdsb2JhbCB2YXJpYWJsZXMgLi4uXG4gICAgRXh0ZW5zaW9uU3RvcmFnZVBhdGggPSBleHRlbnNpb25Db250ZXh0LnN0b3JhZ2VQYXRoO1xuICAgIGNvbnNvbGUubG9nKFwiQWN0aXZhdGluZyB0aGUgQVBJIFJlbW90aW5nIGV4dGVuc2lvbiAuLi5cIilcbiAgICB0cnkge1xuICAgICAgICBhd2FpdCBpbml0aWFsaXplQnVpbGREaXIoRVhURU5TSU9OX0JVSUxEX1BBVEgpO1xuICAgICAgICBjb25zb2xlLmxvZyhgSW5zdGFsbGluZyBBUElSIHZlcnNpb24gJHtBcGlyVmVyc2lvbn0gLi4uYCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBVc2luZyBpbWFnZSAke1JhbWFsYW1hUmVtb3RpbmdJbWFnZX1gKTtcblxuICAgICAgICBhd2FpdCBpbml0aWFsaXplU3RvcmFnZURpcihleHRlbnNpb25Db250ZXh0LnN0b3JhZ2VQYXRoLCBFWFRFTlNJT05fQlVJTERfUEFUSCk7XG5cbiAgICAgICAgY29uc29sZS5sb2coYFByZXBhcmluZyB0aGUga3J1bmtpdCBiaW5hcmllcyAuLi5gKTtcbiAgICAgICAgYXdhaXQgcHJlcGFyZV9rcnVua2l0KCk7XG5cbiAgICAgICAgY29uc29sZS5sb2coYExvYWRpbmcgdGhlIG1vZGVscyAuLi5gKTtcbiAgICAgICAgcmVmcmVzaEF2YWlsYWJsZU1vZGVscygpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBDb3VsZG4ndCBpbml0aWFsaXplIHRoZSBleHRlbnNpb246ICR7ZXJyb3J9YFxuXG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuICAgICAgICAvLyB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG5cbiAgICAvLyByZWdpc3RlciB0aGUgY29tbWFuZCByZWZlcmVuY2VkIGluIHBhY2thZ2UuanNvbiBmaWxlXG4gICAgY29uc3QgbWVudUNvbW1hbmQgPSBleHRlbnNpb25BcGkuY29tbWFuZHMucmVnaXN0ZXJDb21tYW5kKCdsbGFtYS5jcHAuYXBpci5tZW51JywgYXN5bmMgKCkgPT4ge1xuICAgICAgICBpZiAoRkFJTF9JRl9OT1RfTUFDICYmICFleHRlbnNpb25BcGkuZW52LmlzTWFjKSB7XG4gICAgICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UoYGxsYW1hLmNwcCBBUEkgUmVtb3Rpbmcgb25seSBzdXBwb3J0ZWQgb24gTWFjT1MuYCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBsZXQgcmVzdWx0O1xuICAgICAgICBpZiAoU0hPV19JTklUSUFMX01FTlUpIHtcbiAgICAgICAgICAgIC8vIGRpc3BsYXkgYSBjaG9pY2UgdG8gdGhlIHVzZXIgZm9yIHNlbGVjdGluZyBzb21lIHZhbHVlc1xuICAgICAgICAgICAgcmVzdWx0ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93UXVpY2tQaWNrKE9iamVjdC5rZXlzKE1BSU5fTUVOVV9DSE9JQ0VTKSwge1xuICAgICAgICAgICAgICAgIHRpdGxlOiBcIldoYXQgZG8geW91IHdhbnQgdG8gZG8/XCIsXG4gICAgICAgICAgICAgICAgY2FuUGlja01hbnk6IGZhbHNlLCAvLyB1c2VyIGNhbiBzZWxlY3QgbW9yZSB0aGFuIG9uZSBjaG9pY2VcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVzdWx0ID0gTUFJTl9NRU5VX0NIT0lDRVNbMl07XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmVzdWx0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiTm8gdXNlciBjaG9pY2UsIGFib3J0aW5nLlwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICBNQUlOX01FTlVfQ0hPSUNFU1tyZXN1bHRdKCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICBjb25zdCBtc2cgPSBgVGFzayBmYWlsZWQ6ICR7U3RyaW5nKGVycm9yKX1gO1xuICAgICAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuICAgICAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG5cbiAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgLy8gY3JlYXRlIGFuIGl0ZW0gaW4gdGhlIHN0YXR1cyBiYXIgdG8gcnVuIG91ciBjb21tYW5kXG4gICAgICAgIC8vIGl0IHdpbGwgc3RpY2sgb24gdGhlIGxlZnQgb2YgdGhlIHN0YXR1cyBiYXJcbiAgICAgICAgY29uc3QgaXRlbSA9IGV4dGVuc2lvbkFwaS53aW5kb3cuY3JlYXRlU3RhdHVzQmFySXRlbShleHRlbnNpb25BcGkuU3RhdHVzQmFyQWxpZ25MZWZ0LCAxMDApO1xuICAgICAgICBpdGVtLnRleHQgPSAnTGxhbWEuY3BwIEFQSSBSZW1vdGluZyc7XG4gICAgICAgIGl0ZW0uY29tbWFuZCA9ICdsbGFtYS5jcHAuYXBpci5tZW51JztcbiAgICAgICAgaXRlbS5zaG93KCk7XG5cbiAgICAgICAgLy8gcmVnaXN0ZXIgZGlzcG9zYWJsZSByZXNvdXJjZXMgdG8gaXQncyByZW1vdmVkIHdoZW4geW91IGRlYWN0aXZ0ZSB0aGUgZXh0ZW5zaW9uXG4gICAgICAgIGV4dGVuc2lvbkNvbnRleHQuc3Vic2NyaXB0aW9ucy5wdXNoKG1lbnVDb21tYW5kKTtcbiAgICAgICAgZXh0ZW5zaW9uQ29udGV4dC5zdWJzY3JpcHRpb25zLnB1c2goaXRlbSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgbXNnID0gYENvdWxkbid0IHN1YnNjcmliZSB0aGUgZXh0ZW5zaW9uIHRvIFBvZG1hbiBEZXNrdG9wOiAke2Vycm9yfWBcblxuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVhY3RpdmF0ZSgpOiBQcm9taXNlPHZvaWQ+IHtcblxufVxuXG5hc3luYyBmdW5jdGlvbiByZXN0YXJ0X3BvZG1hbl9tYWNoaW5lX3dpdGhfYXBpcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoTG9jYWxCdWlsZERpciA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJMb2NhbEJ1aWxkRGlyIG5vdCBsb2FkZWQuIFRoaXMgaXMgdW5leHBlY3RlZC5cIik7XG5cbiAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UoYFJlc3RhcnRpbmcgUG9kbWFuIG1hY2hpbmUgd2l0aCBBUElSIHN1cHBvcnQgLi4uYCk7XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLnByb2Nlc3MuZXhlYyhcIi91c3IvYmluL2VudlwiLCBbXCJiYXNoXCIsIGAke0xvY2FsQnVpbGREaXJ9L3BvZG1hbl9zdGFydF9tYWNoaW5lLmFwaV9yZW1vdGluZy5zaGBdLCB7Y3dkOiBMb2NhbEJ1aWxkRGlyfSk7XG5cbiAgICAgICAgY29uc3QgbXNnID0gXCJQb2RtYW4gbWFjaGluZSBzdWNjZXNzZnVsbHkgcmVzdGFydCB3aXRoIHRoZSBBUElSIGxpYnJhcmllc1wiXG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShtc2cpO1xuICAgICAgICBjb25zb2xlLmxvZyhtc2cpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IFwiRmFpbGVkIHRvIHJlc3RhcnQgcG9kbWFuIG1hY2hpbmUgd2l0aCB0aGUgQVBJIGxpYnJhcmllczogJHtlcnJvcn1cIlxuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihtc2cpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc3RhcnRfcG9kbWFuX21hY2hpbmVfd2l0aG91dF9hcGlyKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShgUmVzdGFydGluZyBQb2RtYW4gbWFjaGluZSB3aXRob3V0IEFQSSBSZW1vdGluZyBzdXBwb3J0YCk7XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zb2xlLmxvZyhgU3RvcHBpbmcgdGhlIFBvZE1hbiBNYWNoaW5lIC4uLmApO1xuICAgICAgICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLnByb2Nlc3MuZXhlYyhcInBvZG1hblwiLCBbJ21hY2hpbmUnLCAnc3RvcCddKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBtc2cgPSBgRmFpbGVkIHRvIHN0b3AgdGhlIFBvZE1hbiBNYWNoaW5lOiAke2Vycm9yfWA7XG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBTdGFydGluZyB0aGUgUG9kTWFuIE1hY2hpbmUgLi4uYCk7XG4gICAgICAgIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleHRlbnNpb25BcGkucHJvY2Vzcy5leGVjKFwicG9kbWFuXCIsIFsnbWFjaGluZScsICdzdGFydCddKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBtc2cgPSBgRmFpbGVkIHRvIHJlc3RhcnQgdGhlIFBvZE1hbiBNYWNoaW5lOiAke2Vycm9yfWA7XG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cblxuICAgIGNvbnN0IG1zZyA9IFwiUG9kTWFuIE1hY2hpbmUgc3VjY2Vzc2Z1bGx5IHJlc3RhcnRlZCB3aXRob3V0IEFQSSBSZW1vdGluZyBzdXBwb3J0XCI7XG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKG1zZyk7XG4gICAgY29uc29sZS5lcnJvcihtc2cpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBwcmVwYXJlX2tydW5raXQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKExvY2FsQnVpbGREaXIgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiTG9jYWxCdWlsZERpciBub3QgbG9hZGVkLiBUaGlzIGlzIHVuZXhwZWN0ZWQuXCIpO1xuXG4gICAgaWYgKGZzLmV4aXN0c1N5bmMoYCR7TG9jYWxCdWlsZERpcn0vYmluL2tydW5raXRgKSkge1xuICAgICAgICBjb25zb2xlLmxvZyhcIkJpbmFyaWVzIGFscmVhZHkgcHJlcGFyZWQuXCIpXG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UoYFByZXBhcmluZyB0aGUga3J1bmtpdCBiaW5hcmllcyBmb3IgQVBJIFJlbW90aW5nIC4uLmApO1xuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4dGVuc2lvbkFwaS5wcm9jZXNzLmV4ZWMoXCIvdXNyL2Jpbi9lbnZcIiwgW1wiYmFzaFwiLCBgJHtMb2NhbEJ1aWxkRGlyfS91cGRhdGVfa3J1bmtpdC5zaGBdLCB7Y3dkOiBMb2NhbEJ1aWxkRGlyfSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihlcnJvcik7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgQ291bGRuJ3QgdXBkYXRlIHRoZSBrcnVua2l0IGJpbmFyaWVzOiAke2Vycm9yfTogJHtlcnJvci5zdGRvdXR9YCk7XG4gICAgfVxuICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShgQmluYXJpZXMgc3VjY2Vzc2Z1bGx5IHByZXBhcmVkIWApO1xuXG4gICAgY29uc29sZS5sb2coXCJCaW5hcmllcyBzdWNjZXNzZnVsbHkgcHJlcGFyZWQhXCIpXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNoZWNrUG9kbWFuTWFjaGluZVN0YXR1cygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLnByb2Nlc3MuZXhlYyhcIi91c3IvYmluL2VudlwiLCBbXCJiYXNoXCIsIGAke0VYVEVOU0lPTl9CVUlMRF9QQVRIfS9jaGVja19wb2RtYW5fbWFjaGluZV9zdGF0dXMuc2hgXSwge2N3ZDogTG9jYWxCdWlsZERpcn0pO1xuICAgICAgICAvLyBleGl0IHdpdGggc3VjY2Vzcywga3J1bmtpdCBpcyBydW5uaW5nIEFQSSByZW1vdGluZ1xuICAgICAgICBjb25zdCBzdGF0dXMgPSBzdGRvdXQucmVwbGFjZSgvXFxuJC8sIFwiXCIpXG4gICAgICAgIGNvbnN0IG1zZyA9IGBQb2RtYW4gTWFjaGluZSBBUEkgUmVtb3Rpbmcgc3RhdHVzOlxcbiR7c3RhdHVzfWBcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKG1zZyk7XG4gICAgICAgIGNvbnNvbGUubG9nKG1zZyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihlcnJvcik7XG4gICAgICAgIGxldCBtc2c7XG4gICAgICAgIGNvbnN0IHN0YXR1cyA9IGVycm9yLnN0ZG91dC5yZXBsYWNlKC9cXG4kLywgXCJcIilcbiAgICAgICAgY29uc3QgZXhpdENvZGUgPSBlcnJvci5leGl0Q29kZTtcblxuICAgICAgICBpZiAoZXhpdENvZGUgPiAxMCAmJiBleGl0Q29kZSA8IDIwKSB7XG4gICAgICAgICAgICAvLyBleGl0IHdpdGggY29kZSAxeCA9PT4gc3VjY2Vzc2Z1bCBjb21wbGV0aW9uLCBidXQgbm90IEFQSSBSZW1vdGluZyBzdXBwb3J0XG4gICAgICAgICAgICBtc2cgPWBQb2RtYW4gTWFjaGluZSBzdGF0dXM6ICR7c3RhdHVzfSAoY29kZSAjJHtleGl0Q29kZX0pYDtcbiAgICAgICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShtc2cpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gb3RoZXIgZXhpdCBjb2RlIGNyYXNoIG9mIHVuc3VjY2Vzc2Z1bCBjb21wbGV0aW9uXG4gICAgICAgIG1zZyA9YEZhaWxlZCB0byBjaGVjayBQb2RNYW4gTWFjaGluZSBzdGF0dXM6ICR7c3RhdHVzfSAoY29kZSAjJHtleGl0Q29kZX0pYDtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxufVxuIl0sIm5hbWVzIjpbImNvbnRhaW5lckVuZ2luZSIsImNvbnRhaW5lckluZm8iLCJleHRlbnNpb25BcGkiLCJlcnIiLCJwcm92aWRlciIsImNvbm5lY3Rpb24iLCJpbWFnZUluZm8iLCJtc2ciXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFjTyxNQUFNLE1BQUEsR0FBaUI7QUFFOUIsTUFBTSxJQUFBLEdBQU8sUUFBUSxNQUFNLENBQUE7QUFDM0IsTUFBTSxFQUFBLEdBQUssUUFBUSxJQUFJLENBQUE7QUFDdkIsTUFBTSxRQUFBLEdBQVcsUUFBUSxhQUFhLENBQUE7QUFFdEMsTUFBTSxrQkFBa0IsRUFBQztBQUN6QixJQUFJLG9CQUFBLEdBQXVCLE1BQUE7QUFLM0IsTUFBTSxvQkFBQSxHQUF1QixJQUFBLENBQUssS0FBQSxDQUFNLFVBQVUsRUFBRSxHQUFBLEdBQU0sV0FBQTtBQUcxRCxJQUFJLHFCQUFBLEdBQXdCLE1BQUE7QUFDNUIsSUFBSSxXQUFBLEdBQWMsTUFBQTtBQUNsQixJQUFJLGFBQUEsR0FBZ0IsTUFBQTtBQUVwQixNQUFNLGlCQUFBLEdBQW9CO0FBQUEsRUFDdEIsa0RBQUEsRUFBb0QsTUFBTSxnQ0FBQSxFQUFpQztBQUFBLEVBQzNGLHVEQUFBLEVBQXlELE1BQU0sbUNBQUEsRUFBb0M7QUFBQSxFQUNuRyxxREFBQSxFQUF1RCxNQUFNLHlCQUFBLEVBQTBCO0FBQUEsRUFDdkYsMkNBQUEsRUFBNkMsTUFBTSx3QkFBQTtBQUN2RCxDQUFBO0FBRUEsU0FBUyxlQUFBLENBQWdCLFNBQUEsRUFBVyxNQUFBLEVBQVEsUUFBQSxFQUFVO0FBQ2xELEVBQUEsSUFBSSxDQUFDLEVBQUEsQ0FBRyxVQUFBLENBQVcsU0FBUyxDQUFBLEVBQUc7QUFDM0IsSUFBQSxPQUFBLENBQVEsR0FBQSxDQUFJLFdBQVcsU0FBUyxDQUFBO0FBQ2hDLElBQUE7QUFBQSxFQUNKO0FBRUEsRUFBQSxJQUFJLEtBQUEsR0FBUSxFQUFB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
