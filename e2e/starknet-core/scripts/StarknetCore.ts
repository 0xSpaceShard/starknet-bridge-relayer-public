import { ethers } from 'hardhat';
import { IStarknetCoreProxy, Starknet } from '../typechain-types';

async function main() {
  // const provider = new ethers.providers.JsonRpcProvider('http://0.0.0.0:8545');

  const StarknetDAO = '0xd5fb66caee881367df4409b17fd53a2ef0d9b263';
  const StarknetCoreAddress = '0xc662c410C0ECf747543f5bA90660f6ABeBD9C8c4';

  const StarknetDAOSigner = await ethers.getImpersonatedSigner(StarknetDAO);
  const newImpl = await ethers.deployContract('Starknet');

  const starknet = (await ethers.getContractAt('Starknet', StarknetCoreAddress)) as Starknet;
  const starknetProxy = (await ethers.getContractAt('IStarknetCoreProxy', StarknetCoreAddress)) as IStarknetCoreProxy;

  await starknetProxy.connect(StarknetDAOSigner).addImplementation(newImpl.address, ethers.utils.hexZeroPad('0x', 32), false);
  await starknetProxy.connect(StarknetDAOSigner).upgradeTo(newImpl.address, ethers.utils.hexZeroPad('0x', 32), false);

  if ((await starknetProxy.implementation()) != newImpl.address) {
    throw new Error('Upgrade invalid');
  }

  console.log("status:", await starknet.relayer())
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
