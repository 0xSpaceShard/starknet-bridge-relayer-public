import { ConfigService } from 'common/config';
import { INotificationService } from 'notification/notification';

export class RelayerNotifications {
  static emitLowRelayerBalance = async (notificationService: INotificationService, network: string, data: {}) => {
    await notificationService.sendMessage(
      JSON.stringify(
        {
          network,
          Severity: 'HIGH',
          message: `:x: Low relayer balance: ${{ ...data }}`,
        },
        null,
        '  ',
      ),
    );
  };

  static emitHighNetworkFees = async (notificationService: INotificationService, network: string, data: {}) => {
    await notificationService.sendMessage(
      JSON.stringify(
        {
          network,
          Severity: 'WARN',
          message: `:warning: Can not execute a transaction, the network fee is too high : ${{ ...data }}`,
        },
        null,
        '  ',
      ),
    );
  };

  static emitWithdrawalsProcessed = async (notificationService: INotificationService, network: string, data: {}) => {
    await notificationService.sendMessage(
      JSON.stringify(
        {
          network,
          Severity: ':white_check_mark: INFO',
          message: `Withdrawals executed successduly ${{ ...data }}`,
        },
        null,
        '  ',
      ),
    );
  };
}
