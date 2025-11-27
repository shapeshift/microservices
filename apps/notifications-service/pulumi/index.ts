import { readFileSync } from 'fs';
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
  const coinstack = 'notifications-service';

  const { kubeconfig, config, namespace } = await getConfig();
  const sampleEnv = readFileSync('../.env.example');

  const assetName = config.assetName;
  const provider = new k8s.Provider('kube-provider', { kubeconfig });

  createSecret({ name: assetName, env: sampleEnv, namespace }, { provider });

  const docker: DeployApiArgs['docker'] = {
    context: '../../../',
    tag: 'test2',
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
