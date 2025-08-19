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
  if (RamalamaRemotingImage === void 0) throw new Error("Ramalama Remoting image name not loaded. This is unexpected.");
  let model_name;
  if (Object.keys(AvailableModels).length === 0) {
    await extensionApi__namespace.window.showInformationMessage(`Could not find any model downloaded from AI Lab. Please select a GGUF file to load.`);
    let model_name_uri = await extensionApi__namespace.window.showOpenDialog({ tile: "Select a model file", openLabel: "Select a GGUF file", selectors: ["openFile"] });
    if (model_name_uri === void 0) {
      console.log("No model selected, aborting the APIR container launch silently.");
      return;
    }
    model_name = model_name_uri[0].fsPath;
    if (!fs.existsSync(model_name)) {
      const msg = `Selected GGUF model file does not exist: ${model_name}.`;
      console.warn(msg);
      await extensionApi__namespace.window.showErrorMessage(msg);
      return;
    }
  } else {
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
  if (Object.keys(AvailableModels).length === 0) {
    model_src = model_name;
  } else {
    model_src = AvailableModels[model_name];
  }
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
      {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXh0ZW5zaW9uLmpzIiwic291cmNlcyI6WyIuLi9zcmMvZXh0ZW5zaW9uLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0eXBlIHtcbiAgICBDb250YWluZXJDcmVhdGVPcHRpb25zLFxuICAgIENvbnRhaW5lclByb3ZpZGVyQ29ubmVjdGlvbixcbiAgICBEZXZpY2VSZXF1ZXN0LFxuICAgIEltYWdlSW5mbyxcbiAgICBNb3VudENvbmZpZyxcbiAgICBQcm92aWRlckNvbnRhaW5lckNvbm5lY3Rpb24sXG59IGZyb20gJ0Bwb2RtYW4tZGVza3RvcC9hcGknO1xuXG5pbXBvcnQgKiBhcyBleHRlbnNpb25BcGkgZnJvbSAnQHBvZG1hbi1kZXNrdG9wL2FwaSc7XG5pbXBvcnQgdHlwZSB7IFBvZG1hbkNvbm5lY3Rpb24gfSBmcm9tICcuLi8uLi9tYW5hZ2Vycy9wb2RtYW5Db25uZWN0aW9uJztcbmltcG9ydCAqIGFzIFBvZG1hbkNvbm5lY3Rpb25BUEkgZnJvbSAnLi4vLi4vbWFuYWdlcnMvcG9kbWFuQ29ubmVjdGlvbic7XG5pbXBvcnQgeyBjb250YWluZXJFbmdpbmUsIHByb3ZpZGVyLCBQcm9ncmVzc0xvY2F0aW9uIH0gZnJvbSAnQHBvZG1hbi1kZXNrdG9wL2FwaSc7XG5cbmV4cG9ydCBjb25zdCBTRUNPTkQ6IG51bWJlciA9IDFfMDAwXzAwMF8wMDA7XG5cbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzJyk7XG5jb25zdCBhc3luY19mcyA9IHJlcXVpcmUoJ2ZzL3Byb21pc2VzJyk7XG5cbmNvbnN0IEF2YWlsYWJsZU1vZGVscyA9IHt9O1xubGV0IEV4dGVuc2lvblN0b3JhZ2VQYXRoID0gdW5kZWZpbmVkO1xuXG5jb25zdCBGQUlMX0lGX05PVF9NQUMgPSB0cnVlO1xuY29uc3QgU0hPV19JTklUSUFMX01FTlUgPSB0cnVlO1xuY29uc3QgU0hPV19NT0RFTF9TRUxFQ1RfTUVOVSA9IHRydWU7XG5jb25zdCBFWFRFTlNJT05fQlVJTERfUEFUSCA9IHBhdGgucGFyc2UoX19maWxlbmFtZSkuZGlyICsgXCIvLi4vYnVpbGRcIjtcblxuY29uc3QgREVGQVVMVF9NT0RFTF9OQU1FID0gXCJpYm0tZ3Jhbml0ZS9ncmFuaXRlLTMuMy04Yi1pbnN0cnVjdC1HR1VGXCI7IC8vIGlmIG5vdCBzaG93aW5nIHRoZSBzZWxlY3QgbWVudVxubGV0IFJhbWFsYW1hUmVtb3RpbmdJbWFnZSA9IHVuZGVmaW5lZDtcbmxldCBBcGlyVmVyc2lvbiA9IHVuZGVmaW5lZDtcbmxldCBMb2NhbEJ1aWxkRGlyID0gdW5kZWZpbmVkO1xuXG5jb25zdCBNQUlOX01FTlVfQ0hPSUNFUyA9IHtcbiAgICAnUmVzdGFydCBQb2RNYW4gTWFjaGluZSB3aXRoIEFQSSBSZW1vdGluZyBzdXBwb3J0JzogKCkgPT4gcmVzdGFydF9wb2RtYW5fbWFjaGluZV93aXRoX2FwaXIoKSxcbiAgICAnUmVzdGFydCBQb2RNYW4gTWFjaGluZSB3aXRoIHRoZSBkZWZhdWx0IGNvbmZpZ3VyYXRpb24nOiAoKSA9PiByZXN0YXJ0X3BvZG1hbl9tYWNoaW5lX3dpdGhvdXRfYXBpcigpLFxuICAgICdMYXVuY2ggYW4gQVBJIFJlbW90aW5nIGFjY2VsZXJhdGVkIEluZmVyZW5jZSBTZXJ2ZXInOiAoKSA9PiBsYXVuY2hBcGlySW5mZXJlbmNlU2VydmVyKCksXG4gICAgJ0NoZWNrICBQb2RNYW4gTWFjaGluZSBBUEkgUmVtb3Rpbmcgc3RhdHVzJzogKCkgPT4gY2hlY2tQb2RtYW5NYWNoaW5lU3RhdHVzKHRydWUpLFxufVxuXG5mdW5jdGlvbiByZWdpc3RlckZyb21EaXIoc3RhcnRQYXRoLCBmaWx0ZXIsIHJlZ2lzdGVyKSB7XG4gICAgaWYgKCFmcy5leGlzdHNTeW5jKHN0YXJ0UGF0aCkpIHtcbiAgICAgICAgY29uc29sZS5sb2coXCJubyBkaXIgXCIsIHN0YXJ0UGF0aCk7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgZmlsZXMgPSBmcy5yZWFkZGlyU3luYyhzdGFydFBhdGgpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZmlsZXMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIGZpbGVuYW1lID0gcGF0aC5qb2luKHN0YXJ0UGF0aCwgZmlsZXNbaV0pO1xuICAgICAgICB2YXIgc3RhdCA9IGZzLmxzdGF0U3luYyhmaWxlbmFtZSk7XG4gICAgICAgIGlmIChzdGF0LmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgICAgIHJlZ2lzdGVyRnJvbURpcihmaWxlbmFtZSwgZmlsdGVyLCByZWdpc3Rlcik7IC8vcmVjdXJzZVxuICAgICAgICB9IGVsc2UgaWYgKGZpbGVuYW1lLmVuZHNXaXRoKGZpbHRlcikpIHtcbiAgICAgICAgICAgIHJlZ2lzdGVyKGZpbGVuYW1lKTtcbiAgICAgICAgfTtcbiAgICB9O1xufTtcblxuLy8gZ2VuZXJhdGVkIGJ5IGNoYXRncHRcbmFzeW5jIGZ1bmN0aW9uIGNvcHlSZWN1cnNpdmUoc3JjLCBkZXN0KSB7XG4gIGNvbnN0IGVudHJpZXMgPSBhd2FpdCBhc3luY19mcy5yZWFkZGlyKHNyYywgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pO1xuXG4gIGF3YWl0IGFzeW5jX2ZzLm1rZGlyKGRlc3QsIHsgcmVjdXJzaXZlOiB0cnVlIH0pO1xuXG4gIGZvciAobGV0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICBjb25zdCBzcmNQYXRoID0gcGF0aC5qb2luKHNyYywgZW50cnkubmFtZSk7XG4gICAgY29uc3QgZGVzdFBhdGggPSBwYXRoLmpvaW4oZGVzdCwgZW50cnkubmFtZSk7XG5cbiAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgYXdhaXQgY29weVJlY3Vyc2l2ZShzcmNQYXRoLCBkZXN0UGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IGFzeW5jX2ZzLmNvcHlGaWxlKHNyY1BhdGgsIGRlc3RQYXRoKTtcbiAgICB9XG4gIH1cbn1cblxuY29uc3QgZ2V0UmFuZG9tU3RyaW5nID0gKCk6IHN0cmluZyA9PiB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBzb25hcmpzL3BzZXVkby1yYW5kb21cbiAgcmV0dXJuIChNYXRoLnJhbmRvbSgpICsgMSkudG9TdHJpbmcoMzYpLnN1YnN0cmluZyg3KTtcbn07XG5cbmZ1bmN0aW9uIHJlZnJlc2hBdmFpbGFibGVNb2RlbHMoKSB7XG4gICAgaWYgKEV4dGVuc2lvblN0b3JhZ2VQYXRoID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcignRXh0ZW5zaW9uU3RvcmFnZVBhdGggbm90IGRlZmluZWQgOi8nKTtcblxuICAgIC8vIGRlbGV0ZSB0aGUgZXhpc3RpbmcgbW9kZWxzXG4gICAgT2JqZWN0LmtleXMoQXZhaWxhYmxlTW9kZWxzKS5mb3JFYWNoKGtleSA9PiBkZWxldGUgQXZhaWxhYmxlTW9kZWxzW2tleV0pO1xuXG4gICAgY29uc3QgcmVnaXN0ZXJNb2RlbCA9IGZ1bmN0aW9uKGZpbGVuYW1lKSB7XG4gICAgICAgIGNvbnN0IGRpcl9uYW1lID0gZmlsZW5hbWUuc3BsaXQoXCIvXCIpLmF0KC0yKVxuICAgICAgICBjb25zdCBuYW1lX3BhcnRzID0gZGlyX25hbWUuc3BsaXQoXCIuXCIpXG4gICAgICAgIC8vIDAgaXMgdGhlIHNvdXJjZSAoZWcsIGhmKVxuICAgICAgICBjb25zdCBtb2RlbF9kaXIgPSBuYW1lX3BhcnRzLmF0KDEpXG4gICAgICAgIGNvbnN0IG1vZGVsX25hbWUgPSBuYW1lX3BhcnRzLnNsaWNlKDIpLmpvaW4oJy4nKVxuICAgICAgICBjb25zdCBtb2RlbF91c2VyX25hbWUgPSBgJHttb2RlbF9kaXJ9LyR7bW9kZWxfbmFtZX1gXG4gICAgICAgIEF2YWlsYWJsZU1vZGVsc1ttb2RlbF91c2VyX25hbWVdID0gZmlsZW5hbWU7XG4gICAgICAgIGNvbnNvbGUubG9nKGBmb3VuZCAke21vZGVsX3VzZXJfbmFtZX1gKVxuICAgIH1cblxuICAgIHJlZ2lzdGVyRnJvbURpcihFeHRlbnNpb25TdG9yYWdlUGF0aCArICcvLi4vcmVkaGF0LmFpLWxhYi9tb2RlbHMnLCAnLmdndWYnLCByZWdpc3Rlck1vZGVsKTtcbn1cblxuZnVuY3Rpb24gc2xlZXAobXMpIHtcbiAgcmV0dXJuIG5ldyBQcm9taXNlKHJlc29sdmUgPT4gc2V0VGltZW91dChyZXNvbHZlLCBtcykpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBoYXNBcGlyQ29udGFpbmVyUnVubmluZygpIHtcbiAgICBjb25zdCBjb250YWluZXJJbmZvID1cbiAgICAgICAgICAoYXdhaXQgY29udGFpbmVyRW5naW5lLmxpc3RDb250YWluZXJzKCkpXG4gICAgICAgICAgLmZpbmQoY29udGFpbmVySW5mbyA9PiAoY29udGFpbmVySW5mby5MYWJlbHNbXCJsbGFtYS1jcHAuYXBpclwiXSA9PT0gXCJ0cnVlXCIgJiYgY29udGFpbmVySW5mby5TdGF0ZSA9PT0gXCJydW5uaW5nXCIpKTtcblxuICAgIHJldHVybiBjb250YWluZXJJbmZvPy5JZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbGF1bmNoQXBpckluZmVyZW5jZVNlcnZlcigpIHtcbiAgICBjb25zdCBjb250YWluZXJJZCA9IGF3YWl0IGhhc0FwaXJDb250YWluZXJSdW5uaW5nKCk7XG4gICAgaWYgKGNvbnRhaW5lcklkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkFQSSBSZW1vdGluZyBjb250YWluZXIgJHtjb250YWluZXJJZH0gYWxyZWFkeSBydW5uaW5nIC4uLlwiKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKGBBUEkgUmVtb3RpbmcgY29udGFpbmVyICR7Y29udGFpbmVySWR9IGlzIGFscmVhZHkgcnVubmluZy4gVGhpcyB2ZXJzaW9uIGNhbm5vdCBoYXZlIHR3byBBUEkgUmVtb3RpbmcgY29udGFpbmVycyBydW5uaW5nIHNpbXVsdGFuZW91c2x5LmApO1xuICAgICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKFJhbWFsYW1hUmVtb3RpbmdJbWFnZSA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJSYW1hbGFtYSBSZW1vdGluZyBpbWFnZSBuYW1lIG5vdCBsb2FkZWQuIFRoaXMgaXMgdW5leHBlY3RlZC5cIik7XG5cbiAgICBsZXQgbW9kZWxfbmFtZTtcbiAgICBpZiAoT2JqZWN0LmtleXMoQXZhaWxhYmxlTW9kZWxzKS5sZW5ndGggPT09IDApIHtcblx0YXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKGBDb3VsZCBub3QgZmluZCBhbnkgbW9kZWwgZG93bmxvYWRlZCBmcm9tIEFJIExhYi4gUGxlYXNlIHNlbGVjdCBhIEdHVUYgZmlsZSB0byBsb2FkLmApO1xuXHRsZXQgbW9kZWxfbmFtZV91cmkgPSBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dPcGVuRGlhbG9nKHt0aWxlOiBcIlNlbGVjdCBhIG1vZGVsIGZpbGVcIiwgb3BlbkxhYmVsOiBcIlNlbGVjdCBhIEdHVUYgZmlsZVwiLCBzZWxlY3RvcnM6W1wib3BlbkZpbGVcIl19KVxuXG5cdGlmIChtb2RlbF9uYW1lX3VyaSA9PT0gdW5kZWZpbmVkKSB7XG5cdCAgICBjb25zb2xlLmxvZyhcIk5vIG1vZGVsIHNlbGVjdGVkLCBhYm9ydGluZyB0aGUgQVBJUiBjb250YWluZXIgbGF1bmNoIHNpbGVudGx5LlwiKVxuXHQgICAgcmV0dXJuO1xuXHR9XG5cdG1vZGVsX25hbWUgPSBtb2RlbF9uYW1lX3VyaVswXS5mc1BhdGg7XG5cblx0aWYgKCFmcy5leGlzdHNTeW5jKG1vZGVsX25hbWUpKXtcbiAgICAgICAgICAgIGNvbnN0IG1zZyA9IGBTZWxlY3RlZCBHR1VGIG1vZGVsIGZpbGUgZG9lcyBub3QgZXhpc3Q6ICR7bW9kZWxfbmFtZX0uYFxuICAgICAgICAgICAgY29uc29sZS53YXJuKG1zZyk7XG4gICAgICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcblx0ICAgIHJldHVybjtcblx0fVxuXG4gICAgfSBlbHNlIGlmIChTSE9XX01PREVMX1NFTEVDVF9NRU5VKSB7XG4gICAgICAgIHJlZnJlc2hBdmFpbGFibGVNb2RlbHMoKTtcblxuICAgICAgICAvLyBkaXNwbGF5IGEgY2hvaWNlIHRvIHRoZSB1c2VyIGZvciBzZWxlY3Rpbmcgc29tZSB2YWx1ZXNcbiAgICAgICAgbW9kZWxfbmFtZSA9IGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd1F1aWNrUGljayhPYmplY3Qua2V5cyhBdmFpbGFibGVNb2RlbHMpLCB7XG4gICAgICAgICAgICBjYW5QaWNrTWFueTogZmFsc2UsIC8vIHVzZXIgY2FuIHNlbGVjdCBtb3JlIHRoYW4gb25lIGNob2ljZVxuICAgICAgICAgICAgdGl0bGU6IFwiQ2hvb3NlIHRoZSBtb2RlbCB0byBkZXBsb3lcIixcbiAgICAgICAgfSk7XG4gICAgICAgIGlmIChtb2RlbF9uYW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUud2FybignTm8gbW9kZWwgY2hvc2VuLCBub3RoaW5nIHRvIGxhdW5jaC4nKVxuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICB9IGVsc2Uge1xuICAgICAgICBtb2RlbF9uYW1lID0gREVGQVVMVF9NT0RFTF9OQU1FO1xuICAgIH1cblxuICAgIC8vIHByZXBhcmUgdGhlIHBvcnRcbiAgICBsZXQgaG9zdF9wb3J0ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5wdXRCb3goe3RpdGxlOiBcIlNlcnZpY2UgcG9ydFwiLCBwcm9tcHQ6IFwiSW5mZXJlbmNlIHNlcnZpY2UgcG9ydCBvbiB0aGUgaG9zdFwiLCB2YWx1ZTogXCIxMjM0XCIsIHZhbGlkYXRlSW5wdXQ6ICh2YWx1ZSk9PiBwYXJzZUludCh2YWx1ZSwgMTApID4gMTAyNCA/IFwiXCI6IFwiRW50ZXIgYSB2YWxpZCBwb3J0ID4gMTAyNFwifSk7XG4gICAgaG9zdF9wb3J0ID0gcGFyc2VJbnQoaG9zdF9wb3J0KTtcblxuICAgIGlmIChob3N0X3BvcnQgPT09IHVuZGVmaW5lZCB8fCBOdW1iZXIuaXNOYU4oaG9zdF9wb3J0KSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ05vIGhvc3QgcG9ydCBjaG9zZW4sIG5vdGhpbmcgdG8gbGF1bmNoLicpXG4gICAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBwdWxsIHRoZSBpbWFnZVxuICAgIGNvbnN0IGltYWdlSW5mbzogSW1hZ2VJbmZvID0gYXdhaXQgcHVsbEltYWdlKFxuICAgICAgICBSYW1hbGFtYVJlbW90aW5nSW1hZ2UsXG4gICAgICAgIHt9LFxuICAgICk7XG5cblxuICAgIC8vIGdldCBtb2RlbCBtb3VudCBzZXR0aW5nc1xuICAgIGlmIChPYmplY3Qua2V5cyhBdmFpbGFibGVNb2RlbHMpLmxlbmd0aCA9PT0gMCkge1xuXHRtb2RlbF9zcmMgPSBtb2RlbF9uYW1lO1xuICAgIH0gZWxzZSB7XG5cdG1vZGVsX3NyYyA9IEF2YWlsYWJsZU1vZGVsc1ttb2RlbF9uYW1lXTtcbiAgICB9XG4gICAgaWYgKG1vZGVsX3NyYyA9PT0gdW5kZWZpbmVkKVxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYENvdWxkbid0IGdldCB0aGUgZmlsZSBhc3NvY2lhdGVkIHdpdGggbW9kZWwgJHttb2RlbF9zcmN9LiBUaGlzIGlzIHVuZXhwZWN0ZWQuYCk7XG5cbiAgICBjb25zdCBtb2RlbF9maWxlbmFtZSA9IHBhdGguYmFzZW5hbWUobW9kZWxfc3JjKTtcbiAgICBjb25zdCBtb2RlbF9kaXJuYW1lID0gcGF0aC5iYXNlbmFtZShwYXRoLmRpcm5hbWUobW9kZWxfc3JjKSk7XG4gICAgY29uc3QgbW9kZWxfZGVzdCA9IGAvbW9kZWxzLyR7bW9kZWxfZmlsZW5hbWV9YDtcbiAgICBjb25zdCBhaV9sYWJfcG9ydCA9IDEwNDM0O1xuXG4gICAgLy8gcHJlcGFyZSB0aGUgbGFiZWxzXG4gICAgY29uc3QgbGFiZWxzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgICBbJ2FpLWxhYi1pbmZlcmVuY2Utc2VydmVyJ106IEpTT04uc3RyaW5naWZ5KFttb2RlbF9kaXJuYW1lXSksXG4gICAgICAgIFsnYXBpJ106IGBodHRwOi8vbG9jYWxob3N0OiR7aG9zdF9wb3J0fS92MWAsXG4gICAgICAgIFsnZG9jcyddOiBgaHR0cDovL2xvY2FsaG9zdDoke2FpX2xhYl9wb3J0fS9hcGktZG9jcy8ke2hvc3RfcG9ydH1gLFxuICAgICAgICBbJ2dwdSddOiBgbGxhbWEuY3BwIEFQSSBSZW1vdGluZ2AsXG4gICAgICAgIFtcInRyYWNraW5nSWRcIl06IGdldFJhbmRvbVN0cmluZygpLFxuICAgICAgICBbXCJsbGFtYS1jcHAuYXBpclwiXTogXCJ0cnVlXCIsXG4gICAgfTtcblxuICAgIC8vIHByZXBhcmUgdGhlIG1vdW50c1xuICAgIC8vIG1vdW50IHRoZSBmaWxlIGRpcmVjdG9yeSB0byBhdm9pZCBhZGRpbmcgb3RoZXIgZmlsZXMgdG8gdGhlIGNvbnRhaW5lcnNcbiAgICBjb25zdCBtb3VudHM6IE1vdW50Q29uZmlnID0gW1xuICAgICAge1xuICAgICAgICAgIFRhcmdldDogbW9kZWxfZGVzdCxcbiAgICAgICAgICBTb3VyY2U6IG1vZGVsX3NyYyxcbiAgICAgICAgICBUeXBlOiAnYmluZCcsXG4gICAgICB9LFxuICAgIF07XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBlbnRyeXBvaW50XG4gICAgbGV0IGVudHJ5cG9pbnQ6IHN0cmluZyB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcbiAgICBsZXQgY21kOiBzdHJpbmdbXSA9IFtdO1xuXG4gICAgZW50cnlwb2ludCA9IFwiL3Vzci9iaW4vbGxhbWEtc2VydmVyLnNoXCI7XG5cbiAgICAvLyBwcmVwYXJlIHRoZSBlbnZcbiAgICBjb25zdCBlbnZzOiBzdHJpbmdbXSA9IFtgTU9ERUxfUEFUSD0ke21vZGVsX2Rlc3R9YCwgJ0hPU1Q9MC4wLjAuMCcsICdQT1JUPTgwMDAnLCAnR1BVX0xBWUVSUz05OTknXTtcblxuICAgIC8vIHByZXBhcmUgdGhlIGRldmljZXNcbiAgICBjb25zdCBkZXZpY2VzOiBEZXZpY2VbXSA9IFtdO1xuICAgIGRldmljZXMucHVzaCh7XG4gICAgICAgIFBhdGhPbkhvc3Q6ICcvZGV2L2RyaScsXG4gICAgICAgIFBhdGhJbkNvbnRhaW5lcjogJy9kZXYvZHJpJyxcbiAgICAgICAgQ2dyb3VwUGVybWlzc2lvbnM6ICcnLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZGV2aWNlUmVxdWVzdHM6IERldmljZVJlcXVlc3RbXSA9IFtdO1xuICAgIGRldmljZVJlcXVlc3RzLnB1c2goe1xuICAgICAgICBDYXBhYmlsaXRpZXM6IFtbJ2dwdSddXSxcbiAgICAgICAgQ291bnQ6IC0xLCAvLyAtMTogYWxsXG4gICAgfSk7XG5cbiAgICAvLyBHZXQgdGhlIGNvbnRhaW5lciBjcmVhdGlvbiBvcHRpb25zXG4gICAgY29uc3QgY29udGFpbmVyQ3JlYXRlT3B0aW9uczogQ29udGFpbmVyQ3JlYXRlT3B0aW9ucyA9IHtcbiAgICAgICAgSW1hZ2U6IGltYWdlSW5mby5JZCxcbiAgICAgICAgRGV0YWNoOiB0cnVlLFxuICAgICAgICBFbnRyeXBvaW50OiBlbnRyeXBvaW50LFxuICAgICAgICBDbWQ6IGNtZCxcbiAgICAgICAgRXhwb3NlZFBvcnRzOiB7IFtgJHtob3N0X3BvcnR9YF06IHt9IH0sXG4gICAgICAgIEhvc3RDb25maWc6IHtcbiAgICAgICAgICAgIEF1dG9SZW1vdmU6IGZhbHNlLFxuICAgICAgICAgICAgRGV2aWNlczogZGV2aWNlcyxcbiAgICAgICAgICAgIE1vdW50czogbW91bnRzLFxuICAgICAgICAgICAgRGV2aWNlUmVxdWVzdHM6IGRldmljZVJlcXVlc3RzLFxuICAgICAgICAgICAgU2VjdXJpdHlPcHQ6IFtcImxhYmVsPWRpc2FibGVcIl0sXG4gICAgICAgICAgICBQb3J0QmluZGluZ3M6IHtcbiAgICAgICAgICAgICAgICAnODAwMC90Y3AnOiBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIEhvc3RQb3J0OiBgJHtob3N0X3BvcnR9YCxcbiAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgfSxcblxuICAgICAgICBIZWFsdGhDaGVjazoge1xuICAgICAgICAgIC8vIG11c3QgYmUgdGhlIHBvcnQgSU5TSURFIHRoZSBjb250YWluZXIgbm90IHRoZSBleHBvc2VkIG9uZVxuICAgICAgICAgIFRlc3Q6IFsnQ01ELVNIRUxMJywgYGN1cmwgLXNTZiBsb2NhbGhvc3Q6ODAwMCA+IC9kZXYvbnVsbGBdLFxuICAgICAgICAgIEludGVydmFsOiBTRUNPTkQgKiA1LFxuICAgICAgICAgIFJldHJpZXM6IDQgKiA1LFxuICAgICAgICAgIH0sXG4gICAgICAgIExhYmVsczogbGFiZWxzLFxuICAgICAgICBFbnY6IGVudnMsXG4gICAgfTtcbiAgICBjb25zb2xlLmxvZyhjb250YWluZXJDcmVhdGVPcHRpb25zLCBtb3VudHMpXG4gICAgLy8gQ3JlYXRlIHRoZSBjb250YWluZXJcbiAgICBjb25zdCB7IGVuZ2luZUlkLCBpZCB9ID0gYXdhaXQgY3JlYXRlQ29udGFpbmVyKGltYWdlSW5mby5lbmdpbmVJZCwgY29udGFpbmVyQ3JlYXRlT3B0aW9ucywgbGFiZWxzKTtcblxuICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShgQVBJIFJlbW90aW5nIGNvbnRhaW5lciAke2lkfSBoYXMgYmVlbiBsYXVuY2hlZCFgKTtcblxufVxuZXhwb3J0IHR5cGUgQmV0dGVyQ29udGFpbmVyQ3JlYXRlUmVzdWx0ID0gQ29udGFpbmVyQ3JlYXRlUmVzdWx0ICYgeyBlbmdpbmVJZDogc3RyaW5nIH07XG5cbmFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUNvbnRhaW5lcihcbiAgICBlbmdpbmVJZDogc3RyaW5nLFxuICAgIGNvbnRhaW5lckNyZWF0ZU9wdGlvbnM6IENvbnRhaW5lckNyZWF0ZU9wdGlvbnMsXG4gICAgbGFiZWxzOiB7IFtpZDogc3RyaW5nXTogc3RyaW5nIH0sXG4pOiBQcm9taXNlPEJldHRlckNvbnRhaW5lckNyZWF0ZVJlc3VsdD4ge1xuXG4gICAgY29uc29sZS5sb2coXCJDcmVhdGluZyBjb250YWluZXIgLi4uXCIpO1xuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGNvbnRhaW5lckVuZ2luZS5jcmVhdGVDb250YWluZXIoZW5naW5lSWQsIGNvbnRhaW5lckNyZWF0ZU9wdGlvbnMpO1xuICAgICAgICBjb25zb2xlLmxvZyhcIkNvbnRhaW5lciBjcmVhdGVkIVwiKTtcblxuICAgICAgICAvLyByZXR1cm4gdGhlIENvbnRhaW5lckNyZWF0ZVJlc3VsdFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgaWQ6IHJlc3VsdC5pZCxcbiAgICAgICAgICAgIGVuZ2luZUlkOiBlbmdpbmVJZCxcbiAgICAgICAgfTtcbiAgICB9IGNhdGNoIChlcnI6IHVua25vd24pIHtcbiAgICAgICAgY29uc3QgbXNnID0gYENvbnRhaW5lciBjcmVhdGlvbiBmYWlsZWQgOi8gJHtTdHJpbmcoZXJyKX1gXG4gICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIHRocm93IGVycjtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHB1bGxJbWFnZShcbiAgICBpbWFnZTogc3RyaW5nLFxuICAgIGxhYmVsczogeyBbaWQ6IHN0cmluZ106IHN0cmluZyB9LFxuKTogUHJvbWlzZTxJbWFnZUluZm8+IHtcbiAgICAvLyBDcmVhdGluZyBhIHRhc2sgdG8gZm9sbG93IHB1bGxpbmcgcHJvZ3Jlc3NcbiAgICBjb25zb2xlLmxvZyhgUHVsbGluZyB0aGUgaW1hZ2UgJHtpbWFnZX0gLi4uYClcblxuICAgIGNvbnN0IHByb3ZpZGVyczogUHJvdmlkZXJDb250YWluZXJDb25uZWN0aW9uW10gPSBwcm92aWRlci5nZXRDb250YWluZXJDb25uZWN0aW9ucygpO1xuICAgIGNvbnN0IHBvZG1hblByb3ZpZGVyID0gcHJvdmlkZXJzXG4gICAgICAgICAgLmZpbHRlcigoeyBjb25uZWN0aW9uIH0pID0+IGNvbm5lY3Rpb24udHlwZSA9PT0gJ3BvZG1hbicpO1xuICAgIGlmICghcG9kbWFuUHJvdmlkZXIpIHRocm93IG5ldyBFcnJvcihgY2Fubm90IGZpbmQgcG9kbWFuIHByb3ZpZGVyYCk7XG5cbiAgICBsZXQgY29ubmVjdGlvbjogQ29udGFpbmVyUHJvdmlkZXJDb25uZWN0aW9uID0gcG9kbWFuUHJvdmlkZXJbMF0uY29ubmVjdGlvbjtcblxuICAgIC8vIGdldCB0aGUgZGVmYXVsdCBpbWFnZSBpbmZvIGZvciB0aGlzIHByb3ZpZGVyXG4gICAgcmV0dXJuIGdldEltYWdlSW5mbyhjb25uZWN0aW9uLCBpbWFnZSwgKF9ldmVudDogUHVsbEV2ZW50KSA9PiB7fSlcbiAgICAgICAgLmNhdGNoKChlcnI6IHVua25vd24pID0+IHtcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFNvbWV0aGluZyB3ZW50IHdyb25nIHdoaWxlIHB1bGxpbmcgJHtpbWFnZX06ICR7U3RyaW5nKGVycil9YCk7XG4gICAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH0pXG4gICAgICAgIC50aGVuKGltYWdlSW5mbyA9PiB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIkltYWdlIHB1bGxlZCBzdWNjZXNzZnVsbHlcIik7XG4gICAgICAgICAgICByZXR1cm4gaW1hZ2VJbmZvO1xuICAgICAgICB9KTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ2V0SW1hZ2VJbmZvKFxuICBjb25uZWN0aW9uOiBDb250YWluZXJQcm92aWRlckNvbm5lY3Rpb24sXG4gIGltYWdlOiBzdHJpbmcsXG4gIGNhbGxiYWNrOiAoZXZlbnQ6IFB1bGxFdmVudCkgPT4gdm9pZCxcbik6IFByb21pc2U8SW1hZ2VJbmZvPiB7XG4gICAgbGV0IGltYWdlSW5mbyA9IHVuZGVmaW5lZDtcblxuICAgIHRyeSB7XG4gICAgICAgIC8vIFB1bGwgaW1hZ2VcbiAgICAgICAgYXdhaXQgY29udGFpbmVyRW5naW5lLnB1bGxJbWFnZShjb25uZWN0aW9uLCBpbWFnZSwgY2FsbGJhY2spO1xuXG4gICAgICAgIC8vIEdldCBpbWFnZSBpbnNwZWN0XG4gICAgICAgIGltYWdlSW5mbyA9IChcbiAgICAgICAgICAgIGF3YWl0IGNvbnRhaW5lckVuZ2luZS5saXN0SW1hZ2VzKHtcbiAgICAgICAgICAgICAgICBwcm92aWRlcjogY29ubmVjdGlvbixcbiAgICAgICAgICAgIH0gYXMgTGlzdEltYWdlc09wdGlvbnMpXG4gICAgICAgICkuZmluZChpbWFnZUluZm8gPT4gaW1hZ2VJbmZvLlJlcG9UYWdzPy5zb21lKHRhZyA9PiB0YWcgPT09IGltYWdlKSk7XG5cbiAgICB9IGNhdGNoIChlcnI6IHVua25vd24pIHtcbiAgICAgICAgY29uc29sZS53YXJuKCdTb21ldGhpbmcgd2VudCB3cm9uZyB3aGlsZSB0cnlpbmcgdG8gZ2V0IGltYWdlIGluc3BlY3QnLCBlcnIpO1xuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UoYFNvbWV0aGluZyB3ZW50IHdyb25nIHdoaWxlIHRyeWluZyB0byBnZXQgaW1hZ2UgaW5zcGVjdDogJHtlcnJ9YCk7XG5cbiAgICAgICAgdGhyb3cgZXJyO1xuICAgIH1cblxuICAgIGlmIChpbWFnZUluZm8gPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKGBpbWFnZSAke2ltYWdlfSBub3QgZm91bmQuYCk7XG5cbiAgICByZXR1cm4gaW1hZ2VJbmZvO1xufVxuXG5hc3luYyBmdW5jdGlvbiBpbml0aWFsaXplQnVpbGREaXIoYnVpbGRQYXRoKSB7XG4gICAgY29uc29sZS5sb2coYEluaXRpYWxpemluZyB0aGUgYnVpbGQgZGlyZWN0b3J5IGZyb20gJHtidWlsZFBhdGh9IC4uLmApXG5cbiAgICBBcGlyVmVyc2lvbiA9IChhd2FpdCBhc3luY19mcy5yZWFkRmlsZShidWlsZFBhdGggKyAnL3NyY19pbmZvL3ZlcnNpb24udHh0JywgJ3V0ZjgnKSkucmVwbGFjZSgvXFxuJC8sIFwiXCIpO1xuXG4gICAgaWYgKFJhbWFsYW1hUmVtb3RpbmdJbWFnZSA9PT0gdW5kZWZpbmVkKVxuICAgICAgICBSYW1hbGFtYVJlbW90aW5nSW1hZ2UgPSAoYXdhaXQgYXN5bmNfZnMucmVhZEZpbGUoYnVpbGRQYXRoICsgJy9zcmNfaW5mby9yYW1hbGFtYS5pbWFnZS1pbmZvLnR4dCcsICd1dGY4JykpLnJlcGxhY2UoL1xcbiQvLCBcIlwiKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gaW5pdGlhbGl6ZVN0b3JhZ2VEaXIoc3RvcmFnZVBhdGgsIGJ1aWxkUGF0aCkge1xuICAgIGNvbnNvbGUubG9nKGBJbml0aWFsaXppbmcgdGhlIHN0b3JhZ2UgZGlyZWN0b3J5IC4uLmApXG5cbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMoc3RvcmFnZVBhdGgpKXtcbiAgICAgICAgZnMubWtkaXJTeW5jKHN0b3JhZ2VQYXRoKTtcbiAgICB9XG5cbiAgICBpZiAoQXBpclZlcnNpb24gPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKFwiQVBJUiB2ZXJzaW9uIG5vdCBsb2FkZWQuIFRoaXMgaXMgdW5leHBlY3RlZC5cIik7XG5cbiAgICBMb2NhbEJ1aWxkRGlyID0gYCR7c3RvcmFnZVBhdGh9LyR7QXBpclZlcnNpb259YDtcbiAgICBpZiAoIWZzLmV4aXN0c1N5bmMoTG9jYWxCdWlsZERpcikpe1xuICAgICAgICBjb3B5UmVjdXJzaXZlKGJ1aWxkUGF0aCwgTG9jYWxCdWlsZERpcilcbiAgICAgICAgICAgIC50aGVuKCgpID0+IGNvbnNvbGUubG9nKCdDb3B5IGNvbXBsZXRlJykpO1xuICAgIH1cbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFjdGl2YXRlKGV4dGVuc2lvbkNvbnRleHQ6IGV4dGVuc2lvbkFwaS5FeHRlbnNpb25Db250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gaW5pdGlhbGl6ZSB0aGUgZ2xvYmFsIHZhcmlhYmxlcyAuLi5cbiAgICBFeHRlbnNpb25TdG9yYWdlUGF0aCA9IGV4dGVuc2lvbkNvbnRleHQuc3RvcmFnZVBhdGg7XG4gICAgY29uc29sZS5sb2coXCJBY3RpdmF0aW5nIHRoZSBBUEkgUmVtb3RpbmcgZXh0ZW5zaW9uIC4uLlwiKVxuICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGluaXRpYWxpemVCdWlsZERpcihFWFRFTlNJT05fQlVJTERfUEFUSCk7XG4gICAgICAgIGNvbnNvbGUubG9nKGBJbnN0YWxsaW5nIEFQSVIgdmVyc2lvbiAke0FwaXJWZXJzaW9ufSAuLi5gKTtcbiAgICAgICAgY29uc29sZS5sb2coYFVzaW5nIGltYWdlICR7UmFtYWxhbWFSZW1vdGluZ0ltYWdlfWApO1xuXG4gICAgICAgIGF3YWl0IGluaXRpYWxpemVTdG9yYWdlRGlyKGV4dGVuc2lvbkNvbnRleHQuc3RvcmFnZVBhdGgsIEVYVEVOU0lPTl9CVUlMRF9QQVRIKTtcblxuICAgICAgICBjb25zb2xlLmxvZyhgUHJlcGFyaW5nIHRoZSBrcnVua2l0IGJpbmFyaWVzIC4uLmApO1xuICAgICAgICBhd2FpdCBwcmVwYXJlX2tydW5raXQoKTtcblxuICAgICAgICBjb25zb2xlLmxvZyhgTG9hZGluZyB0aGUgbW9kZWxzIC4uLmApO1xuICAgICAgICByZWZyZXNoQXZhaWxhYmxlTW9kZWxzKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgbXNnID0gYENvdWxkbid0IGluaXRpYWxpemUgdGhlIGV4dGVuc2lvbjogJHtlcnJvcn1gXG5cbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIC8vIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cblxuICAgIC8vIHJlZ2lzdGVyIHRoZSBjb21tYW5kIHJlZmVyZW5jZWQgaW4gcGFja2FnZS5qc29uIGZpbGVcbiAgICBjb25zdCBtZW51Q29tbWFuZCA9IGV4dGVuc2lvbkFwaS5jb21tYW5kcy5yZWdpc3RlckNvbW1hbmQoJ2xsYW1hLmNwcC5hcGlyLm1lbnUnLCBhc3luYyAoKSA9PiB7XG4gICAgICAgIGlmIChGQUlMX0lGX05PVF9NQUMgJiYgIWV4dGVuc2lvbkFwaS5lbnYuaXNNYWMpIHtcbiAgICAgICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShgbGxhbWEuY3BwIEFQSSBSZW1vdGluZyBvbmx5IHN1cHBvcnRlZCBvbiBNYWNPUy5gKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGxldCByZXN1bHQ7XG4gICAgICAgIGlmIChTSE9XX0lOSVRJQUxfTUVOVSkge1xuICAgICAgICAgICAgLy8gZGlzcGxheSBhIGNob2ljZSB0byB0aGUgdXNlciBmb3Igc2VsZWN0aW5nIHNvbWUgdmFsdWVzXG4gICAgICAgICAgICByZXN1bHQgPSBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dRdWlja1BpY2soT2JqZWN0LmtleXMoTUFJTl9NRU5VX0NIT0lDRVMpLCB7XG4gICAgICAgICAgICAgICAgdGl0bGU6IFwiV2hhdCBkbyB5b3Ugd2FudCB0byBkbz9cIixcbiAgICAgICAgICAgICAgICBjYW5QaWNrTWFueTogZmFsc2UsIC8vIHVzZXIgY2FuIHNlbGVjdCBtb3JlIHRoYW4gb25lIGNob2ljZVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXN1bHQgPSBNQUlOX01FTlVfQ0hPSUNFU1syXTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChyZXN1bHQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJObyB1c2VyIGNob2ljZSwgYWJvcnRpbmcuXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIE1BSU5fTUVOVV9DSE9JQ0VTW3Jlc3VsdF0oKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIGNvbnN0IG1zZyA9IGBUYXNrIGZhaWxlZDogJHtTdHJpbmcoZXJyb3IpfWA7XG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG4gICAgICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dFcnJvck1lc3NhZ2UobXNnKTtcblxuICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9XG4gICAgfSk7XG5cbiAgICB0cnkge1xuICAgICAgICAvLyBjcmVhdGUgYW4gaXRlbSBpbiB0aGUgc3RhdHVzIGJhciB0byBydW4gb3VyIGNvbW1hbmRcbiAgICAgICAgLy8gaXQgd2lsbCBzdGljayBvbiB0aGUgbGVmdCBvZiB0aGUgc3RhdHVzIGJhclxuICAgICAgICBjb25zdCBpdGVtID0gZXh0ZW5zaW9uQXBpLndpbmRvdy5jcmVhdGVTdGF0dXNCYXJJdGVtKGV4dGVuc2lvbkFwaS5TdGF0dXNCYXJBbGlnbkxlZnQsIDEwMCk7XG4gICAgICAgIGl0ZW0udGV4dCA9ICdMbGFtYS5jcHAgQVBJIFJlbW90aW5nJztcbiAgICAgICAgaXRlbS5jb21tYW5kID0gJ2xsYW1hLmNwcC5hcGlyLm1lbnUnO1xuICAgICAgICBpdGVtLnNob3coKTtcblxuICAgICAgICAvLyByZWdpc3RlciBkaXNwb3NhYmxlIHJlc291cmNlcyB0byBpdCdzIHJlbW92ZWQgd2hlbiB5b3UgZGVhY3RpdnRlIHRoZSBleHRlbnNpb25cbiAgICAgICAgZXh0ZW5zaW9uQ29udGV4dC5zdWJzY3JpcHRpb25zLnB1c2gobWVudUNvbW1hbmQpO1xuICAgICAgICBleHRlbnNpb25Db250ZXh0LnN1YnNjcmlwdGlvbnMucHVzaChpdGVtKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBtc2cgPSBgQ291bGRuJ3Qgc3Vic2NyaWJlIHRoZSBleHRlbnNpb24gdG8gUG9kbWFuIERlc2t0b3A6ICR7ZXJyb3J9YFxuXG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IobXNnKTtcbiAgICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWFjdGl2YXRlKCk6IFByb21pc2U8dm9pZD4ge1xuXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlc3RhcnRfcG9kbWFuX21hY2hpbmVfd2l0aF9hcGlyKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChMb2NhbEJ1aWxkRGlyID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcihcIkxvY2FsQnVpbGREaXIgbm90IGxvYWRlZC4gVGhpcyBpcyB1bmV4cGVjdGVkLlwiKTtcblxuICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShgUmVzdGFydGluZyBQb2RtYW4gbWFjaGluZSB3aXRoIEFQSVIgc3VwcG9ydCAuLi5gKTtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleHRlbnNpb25BcGkucHJvY2Vzcy5leGVjKFwiL3Vzci9iaW4vZW52XCIsIFtcImJhc2hcIiwgYCR7TG9jYWxCdWlsZERpcn0vcG9kbWFuX3N0YXJ0X21hY2hpbmUuYXBpX3JlbW90aW5nLnNoYF0sIHtjd2Q6IExvY2FsQnVpbGREaXJ9KTtcblxuICAgICAgICBjb25zdCBtc2cgPSBcIlBvZG1hbiBtYWNoaW5lIHN1Y2Nlc3NmdWxseSByZXN0YXJ0ZWQgd2l0aCB0aGUgQVBJUiBsaWJyYXJpZXNcIlxuICAgICAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UobXNnKTtcbiAgICAgICAgY29uc29sZS5sb2cobXNnKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBtc2cgPSBgRmFpbGVkIHRvIHJlc3RhcnQgcG9kbWFuIG1hY2hpbmUgd2l0aCB0aGUgQVBJIGxpYnJhcmllczogJHtlcnJvcn1gXG4gICAgICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0Vycm9yTWVzc2FnZShtc2cpO1xuICAgICAgICBjb25zb2xlLmVycm9yKG1zZyk7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihtc2cpO1xuICAgIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVzdGFydF9wb2RtYW5fbWFjaGluZV93aXRob3V0X2FwaXIoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKGBSZXN0YXJ0aW5nIFBvZG1hbiBtYWNoaW5lIHdpdGhvdXQgQVBJIFJlbW90aW5nIHN1cHBvcnRgKTtcblxuICAgIHRyeSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBTdG9wcGluZyB0aGUgUG9kTWFuIE1hY2hpbmUgLi4uYCk7XG4gICAgICAgIGNvbnN0IHsgc3Rkb3V0IH0gPSBhd2FpdCBleHRlbnNpb25BcGkucHJvY2Vzcy5leGVjKFwicG9kbWFuXCIsIFsnbWFjaGluZScsICdzdG9wJ10pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBGYWlsZWQgdG8gc3RvcCB0aGUgUG9kTWFuIE1hY2hpbmU6ICR7ZXJyb3J9YDtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgICAgY29uc29sZS5sb2coYFN0YXJ0aW5nIHRoZSBQb2RNYW4gTWFjaGluZSAuLi5gKTtcbiAgICAgICAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4dGVuc2lvbkFwaS5wcm9jZXNzLmV4ZWMoXCJwb2RtYW5cIiwgWydtYWNoaW5lJywgJ3N0YXJ0J10pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IG1zZyA9IGBGYWlsZWQgdG8gcmVzdGFydCB0aGUgUG9kTWFuIE1hY2hpbmU6ICR7ZXJyb3J9YDtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxuXG4gICAgY29uc3QgbXNnID0gXCJQb2RNYW4gTWFjaGluZSBzdWNjZXNzZnVsbHkgcmVzdGFydGVkIHdpdGhvdXQgQVBJIFJlbW90aW5nIHN1cHBvcnRcIjtcbiAgICBhd2FpdCBleHRlbnNpb25BcGkud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UobXNnKTtcbiAgICBjb25zb2xlLmVycm9yKG1zZyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHByZXBhcmVfa3J1bmtpdCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoTG9jYWxCdWlsZERpciA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoXCJMb2NhbEJ1aWxkRGlyIG5vdCBsb2FkZWQuIFRoaXMgaXMgdW5leHBlY3RlZC5cIik7XG5cbiAgICBpZiAoZnMuZXhpc3RzU3luYyhgJHtMb2NhbEJ1aWxkRGlyfS9iaW4va3J1bmtpdGApKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiQmluYXJpZXMgYWxyZWFkeSBwcmVwYXJlZC5cIilcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGF3YWl0IGV4dGVuc2lvbkFwaS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZShgUHJlcGFyaW5nIHRoZSBrcnVua2l0IGJpbmFyaWVzIGZvciBBUEkgUmVtb3RpbmcgLi4uYCk7XG5cbiAgICB0cnkge1xuICAgICAgICBjb25zdCB7IHN0ZG91dCB9ID0gYXdhaXQgZXh0ZW5zaW9uQXBpLnByb2Nlc3MuZXhlYyhcIi91c3IvYmluL2VudlwiLCBbXCJiYXNoXCIsIGAke0xvY2FsQnVpbGREaXJ9L3VwZGF0ZV9rcnVua2l0LnNoYF0sIHtjd2Q6IExvY2FsQnVpbGREaXJ9KTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKGVycm9yKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb3VsZG4ndCB1cGRhdGUgdGhlIGtydW5raXQgYmluYXJpZXM6ICR7ZXJyb3J9OiAke2Vycm9yLnN0ZG91dH1gKTtcbiAgICB9XG4gICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKGBCaW5hcmllcyBzdWNjZXNzZnVsbHkgcHJlcGFyZWQhYCk7XG5cbiAgICBjb25zb2xlLmxvZyhcIkJpbmFyaWVzIHN1Y2Nlc3NmdWxseSBwcmVwYXJlZCFcIilcbn1cblxuYXN5bmMgZnVuY3Rpb24gY2hlY2tQb2RtYW5NYWNoaW5lU3RhdHVzKHdpdGhfZ3VpKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgICAgY29uc3QgeyBzdGRvdXQgfSA9IGF3YWl0IGV4dGVuc2lvbkFwaS5wcm9jZXNzLmV4ZWMoXCIvdXNyL2Jpbi9lbnZcIiwgW1wiYmFzaFwiLCBgJHtFWFRFTlNJT05fQlVJTERfUEFUSH0vY2hlY2tfcG9kbWFuX21hY2hpbmVfc3RhdHVzLnNoYF0sIHtjd2Q6IExvY2FsQnVpbGREaXJ9KTtcbiAgICAgICAgLy8gZXhpdCB3aXRoIHN1Y2Nlc3MsIGtydW5raXQgaXMgcnVubmluZyBBUEkgcmVtb3RpbmdcbiAgICAgICAgY29uc3Qgc3RhdHVzID0gc3Rkb3V0LnJlcGxhY2UoL1xcbiQvLCBcIlwiKVxuICAgICAgICBjb25zdCBtc2cgPSBgUG9kbWFuIE1hY2hpbmUgQVBJIFJlbW90aW5nIHN0YXR1czpcXG4ke3N0YXR1c31gXG4gICAgICAgIGlmICh3aXRoX2d1aSkge1xuICAgICAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKG1zZyk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc29sZS5sb2cobXNnKTtcblxuICAgICAgICByZXR1cm4gMDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvL2NvbnNvbGUuZXJyb3IoZXJyb3IpO1xuICAgICAgICBsZXQgbXNnO1xuICAgICAgICBjb25zdCBzdGF0dXMgPSBlcnJvci5zdGRvdXQucmVwbGFjZSgvXFxuJC8sIFwiXCIpXG4gICAgICAgIGNvbnN0IGV4aXRDb2RlID0gZXJyb3IuZXhpdENvZGU7XG5cbiAgICAgICAgaWYgKGV4aXRDb2RlID4gMTAgJiYgZXhpdENvZGUgPCAyMCkge1xuICAgICAgICAgICAgLy8gZXhpdCB3aXRoIGNvZGUgMXggPT0+IHN1Y2Nlc3NmdWwgY29tcGxldGlvbiwgYnV0IG5vdCBBUEkgUmVtb3Rpbmcgc3VwcG9ydFxuICAgICAgICAgICAgbXNnID1gUG9kbWFuIE1hY2hpbmUgc3RhdHVzOiAke3N0YXR1c306IHN0YXR1cyAjJHtleGl0Q29kZX1gO1xuICAgICAgICAgICAgaWYgKHdpdGhfZ3VpKSB7XG4gICAgICAgICAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjb25zb2xlLndhcm4obXNnKVxuICAgICAgICAgICAgcmV0dXJuIGV4aXRDb2RlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gb3RoZXIgZXhpdCBjb2RlIGNyYXNoIG9mIHVuc3VjY2Vzc2Z1bCBjb21wbGV0aW9uXG4gICAgICAgIG1zZyA9YEZhaWxlZCB0byBjaGVjayBQb2RNYW4gTWFjaGluZSBzdGF0dXM6ICR7c3RhdHVzfSAoY29kZSAjJHtleGl0Q29kZX0pYDtcbiAgICAgICAgYXdhaXQgZXh0ZW5zaW9uQXBpLndpbmRvdy5zaG93RXJyb3JNZXNzYWdlKG1zZyk7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IobXNnKTtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKG1zZyk7XG4gICAgfVxufVxuIl0sIm5hbWVzIjpbImNvbnRhaW5lckVuZ2luZSIsImNvbnRhaW5lckluZm8iLCJleHRlbnNpb25BcGkiLCJlcnIiLCJwcm92aWRlciIsImNvbm5lY3Rpb24iLCJpbWFnZUluZm8iLCJtc2ciXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFjTyxNQUFNLE1BQUEsR0FBaUI7QUFFOUIsTUFBTSxJQUFBLEdBQU8sUUFBUSxNQUFNLENBQUE7QUFDM0IsTUFBTSxFQUFBLEdBQUssUUFBUSxJQUFJLENBQUE7QUFDdkIsTUFBTSxRQUFBLEdBQVcsUUFBUSxhQUFhLENBQUE7QUFFdEMsTUFBTSxrQkFBa0IsRUFBQztBQUN6QixJQUFJLG9CQUFBLEdBQXVCLE1BQUE7QUFLM0IsTUFBTSxvQkFBQSxHQUF1QixJQUFBLENBQUssS0FBQSxDQUFNLFVBQVUsRUFBRSxHQUFBLEdBQU0sV0FBQTtBQUcxRCxJQUFJLHFCQUFBLEdBQXdCLE1BQUE7QUFDNUIsSUFBSSxXQUFBLEdBQWMsTUFBQTtBQUNsQixJQUFJLGFBQUEsR0FBZ0IsTUFBQTtBQUVwQixNQUFNLGlCQUFBLEdBQW9CO0FBQUEsRUFDdEIsa0RBQUEsRUFBb0QsTUFBTSxnQ0FBQSxFQUFpQztBQUFBLEVBQzNGLHVEQUFBLEVBQXlELE1BQU0sbUNBQUEsRUFBb0M7QUFBQSxFQUNuRyxxREFBQSxFQUF1RCxNQUFNLHlCQUFBLEVBQTBCO0FBQUEsRUFDdkYsMkNBQUEsRUFBNkMsTUFBTSx3QkFBQSxDQUF5QixJQUFJO0FBQ3BGLENBQUE7QUFFQSxTQUFTLGVBQUEsQ0FBZ0IsU0FBQSxFQUFXLE1BQUEsRUFBUSxRQUFBLEVBQVU7QUFDbEQsRUFBQSxJQUFJLENBQUMsRUFBQSxDQUFHLFVBQUEsQ0FBVyxTQUFTLENBQUEsRUFBRztBQUMzQixJQUFBLE9BQUEsQ0FBUSxHQUFBLENBQUksV0FBVyxTQUFTLENBQUE7QUFDaEMsSUFBQTtBQUFBLEVBQ0o7QUFFQSxFQUFBLElBQUksS0FBQSxHQUFRLEVBQUEsQ0FBRyxXQUFBLENB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
