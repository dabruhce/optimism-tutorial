/* External Imports */
const { ethers, l2ethers } = require('hardhat')
const chai = require('chai')
const { solidity } = require('ethereum-waffle')
const chaiAsPromised = require('chai-as-promised')
const { expect } = chai
const { JsonRpcProvider } = require('@ethersproject/providers');
const { Watcher } = require('@eth-optimism/watcher')
//be as lazy as possible!
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
chai.use(chaiAsPromised)
chai.use(solidity)

describe(`testing L1/L2 contract interaction`, () => {
  //Token configuration
  const INITIAL_SUPPLY = 10000000
  const TOKEN_NAME = 'L1/L2 Deployed Optimistic ERC20'
  //Optimism Constants
  const L1_MESSENGER_ADDRESS = '0x6418E5Da52A3d7543d393ADD3Fa98B0795d27736'
  const L2_MESSENGER_ADDRESS = '0x4200000000000000000000000000000000000007'

  //L1 contracts
  let ERC20_L1
  let GatewayERC20_L1

  //L2 contracts
  let DepositedERC20_L2

  //providers
  const l1_provider = new JsonRpcProvider('http://localhost:9545')
  const l2_provider = new JsonRpcProvider('http://localhost:8545')

  //ACCOUNTS
  //first account L1
  const l1_key = "0x754fde3f5e60ef2c7649061e06957c29017fe21032a8017132c0078e37f6193a"
  const l1_wallet_1 = new ethers.Wallet(l1_key)
  const l1_account_1 = l1_wallet_1.connect(l1_provider)

  //seconds account L1
  const l2_key = "0x754fde3f5e60ef2c7649061e06957c29017fe21032a8017132c0078e37f6193a"
  const l2_wallet_1 = new ethers.Wallet(l2_key)
  const l2_account_1 = l2_wallet_1.connect(l2_provider)

  //first account L2
  const l2_key_2 = "0xd2ab07f7c10ac88d5f86f1b4c1035d5195e81f27dbe62ad65e59cbf88205629b"
  const l2_wallet_2 = new ethers.Wallet(l2_key_2)
  const l2_account_2 = l2_wallet_2.connect(l2_provider)

  before(`deploy and init ERC20 L1 + L2 contracts`, async () => {

    //create factory for ERC20 contract on L1 with l1_account_1 account
    const Factory__ERC20 = await ethers.getContractFactory('ERC20_A')

    ERC20_L1 = await Factory__ERC20.connect(l1_account_1).deploy(
      INITIAL_SUPPLY,
      TOKEN_NAME,
    )
    await ERC20_L1.deployTransaction.wait()

    //create factory for deposit contract on L2 with l2_account_1 account
    const Factory__DepositedERC20 = await l2ethers.getContractFactory("L2DepositedERC20",l2_provider)

    DepositedERC20_L2 = await Factory__DepositedERC20.connect(l2_account_1).deploy(
      L2_MESSENGER_ADDRESS,
      TOKEN_NAME,
      "OPT",
    )
    await DepositedERC20_L2.deployTransaction.wait()

    //create factory for gateway contract on L1 with l1_account_1 account
    const Factory__GatewayERC20_L1 = await ethers.getContractFactory("L1ERC20Gateway",l1_provider);
    GatewayERC20_L1 = await Factory__GatewayERC20_L1.connect(l1_account_1).deploy(
      ERC20_L1.address,
      DepositedERC20_L2.address,
      L1_MESSENGER_ADDRESS,
    )
    await GatewayERC20_L1.deployTransaction.wait()

    //todo
    watcher = new Watcher({
        l1: {
          provider: l1_provider,
          messengerAddress: L1_MESSENGER_ADDRESS
        },
        l2: {
          provider: l2_provider,
          messengerAddress: L2_MESSENGER_ADDRESS
        }
      })

  })


  describe(`checking contract base interactions`, () => {

    it(`should be deployed to correct chains`, async () => {

       //check chains to ensure the correct chainId
       expect(ERC20_L1.deployTransaction.chainId).to.equal(31337)
       expect(GatewayERC20_L1.deployTransaction.chainId).to.equal(31337)
       expect(DepositedERC20_L2.deployTransaction.chainId).to.equal(420)

       //addresses for debug
       /*
       console.log("ERC L1"  + ERC20_L1.address)
       console.log("Gateway L1 "  + GatewayERC20_L1.address)
       console.log("ERC l2 " + DepositedERC20_L2.address)
      */

    })

    it(`should init L2 deposit contract with L1 [Account 1]`, async () => {
       try {
        const initGateway = await DepositedERC20_L2.init(GatewayERC20_L1.address)
        //   console.log("gateway init " + initGateway.hash)
       }
       catch(e) {
         console.log(e)
       }
    })

    it(`should approve erc20, verify L1 [Account 1] balance 10000000`, async () => {
       const approveTx = await ERC20_L1.approve(GatewayERC20_L1.address, 10)
       await approveTx.wait()
       const l1_balance = await ERC20_L1.balanceOf(l1_wallet_1.address)
       expect(l1_balance.toNumber()).to.equal(10000000)
    })

    it(`should deposit to gateway contract, verify L1 [Account 1] balance 9999990`, async () => {
        const gasLimit = await GatewayERC20_L1.DEFAULT_FINALIZE_DEPOSIT_L2_GAS()
        const depositTx = await GatewayERC20_L1.deposit(10, {gasLimit: gasLimit})

        const l1_balance = await ERC20_L1.balanceOf(l1_wallet_1.address)
        expect(l1_balance.toNumber()).to.equal(9999990)

        //Wait for the transaction to be included on L2
        //this allows tx to be included for next test
        //which verifies L2 balance has updated
        const messageHashes = await watcher.getMessageHashesFromL1Tx(depositTx.hash)
        expect(messageHashes.length).to.equal(1)
        let l2txrec = await watcher.getL2TransactionReceipt(messageHashes[0])

    })


    it(`should L2 [Account 1] has balance of 10`, async () => {
      //relies waiting for L2 tx to complete
      const l2_balance = await DepositedERC20_L2.balanceOf(l2_wallet_1.address)
      expect(l2_balance.toNumber()).to.equal(10)
    })


    it(`should L2 [Account 2] has balance 0`, async () => {
      try{
        const l2_balance = await DepositedERC20_L2.balanceOf(l2_wallet_2.address)
        expect(l2_balance.toNumber()).to.equal(0)
      }
      catch (e) {
        console.log(e)
      }

    })

    it(`should L2 [Account 1] transfer to L2 [Account 2]`, async () => {

      try {
        //DepositedERC20_L2 is connected to l2_account_1 on L2,
        //transfer from l2_account_1 to l2_account_2
        const transfer = await DepositedERC20_L2.transfer(l2_wallet_2.address, 5)
        const receipt = await transfer.wait()
        const l2_balance = await DepositedERC20_L2.balanceOf(l2_wallet_2.address)
        expect(l2_balance.toNumber()).to.equal(5)
      }
      catch (e) {
        console.log(e)
      }

    })

  })

})
