import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import * as k8s from '@pulumi/kubernetes';
import {
  Outputs,
  getConfig,
  deployApi,
  createSecret,
  DeployApiArgs,
} from '@shapeshiftoss/unchained-pulumi';

//https://www.pulumi.com/docs/intro/languages/javascript/#entrypoint
export = async (): Promise<Outputs> => {
  const appName = 'shapeshift';
  const coinstack = 'user-service';

  const { kubeconfig, config, namespace } = await getConfig();
  const sampleEnv = readFileSync('../.env.example');

  const assetName = config.assetName;
  const provider = new k8s.Provider('kube-provider', { kubeconfig });

  createSecret({ name: assetName, env: sampleEnv, namespace }, { provider });

  const gitSha = execSync(
    `git log -1 --format=%h -- Dockerfile package.json yarn.lock apps/${coinstack} packages/`,
    { encoding: 'utf8' },
  ).trim();

  const docker: DeployApiArgs['docker'] = {
    context: '../../../',
    tag: gitSha,
    command: ['sh', '-c', 'yarn db:migrate && yarn start:prod'],
  };

  await deployApi({
    appName,
    assetName,
    coinstack,
    config,
    docker,
    namespace,
    provider,
    sampleEnv,
  });

  return {};
};
