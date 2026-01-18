import { Test, TestingModule } from '@nestjs/testing';
import { QuotesController } from './quotes.controller';
import { QuotesService, CreateQuoteDto, QuoteResponse } from './quotes.service';
import { QuoteStatus } from '@prisma/client';
import { SwapperType, SwapperName } from '../swappers/swapper.types';

describe('QuotesController', () => {
  let controller: QuotesController;
  let quotesService: jest.Mocked<QuotesService>;

  const mockQuoteResponse: QuoteResponse = {
    quoteId: 'quote_abc123',
    status: QuoteStatus.ACTIVE,
    depositAddress: '0x1234567890abcdef1234567890abcdef12345678',
    receiveAddress: 'bc1qtest123',
    sellAsset: { symbol: 'ETH', name: 'Ethereum' },
    buyAsset: { symbol: 'BTC', name: 'Bitcoin' },
    sellAmountCryptoBaseUnit: '1000000000000000000',
    expectedBuyAmountCryptoBaseUnit: '3000000',
    swapperName: SwapperName.Chainflip,
    swapperType: SwapperType.DIRECT,
    gasOverheadBaseUnit: null,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    createdAt: new Date(),
    qrData: 'ethereum:0x1234567890abcdef1234567890abcdef12345678?value=1000000000000000000',
  };

  beforeEach(async () => {
    const mockQuotesService = {
      createQuote: jest.fn(),
      getQuote: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuotesController],
      providers: [
        {
          provide: QuotesService,
          useValue: mockQuotesService,
        },
      ],
    }).compile();

    controller = module.get<QuotesController>(QuotesController);
    quotesService = module.get(QuotesService);
  });

  describe('createQuote', () => {
    it('should create a quote and return 201', async () => {
      const createQuoteDto: CreateQuoteDto = {
        sellAssetId: 'eip155:1/slip44:60',
        buyAssetId: 'bip122:000000000019d6689c085ae165831e93/slip44:0',
        sellAmountCryptoBaseUnit: '1000000000000000000',
        receiveAddress: 'bc1qtest123',
        swapperName: SwapperName.Chainflip,
        expectedBuyAmountCryptoBaseUnit: '3000000',
        sellAsset: { symbol: 'ETH', name: 'Ethereum' },
        buyAsset: { symbol: 'BTC', name: 'Bitcoin' },
      };

      quotesService.createQuote.mockResolvedValue(mockQuoteResponse);

      const result = await controller.createQuote(createQuoteDto);

      expect(result).toEqual(mockQuoteResponse);
      expect(quotesService.createQuote).toHaveBeenCalledWith(createQuoteDto);
    });

    it('should return a quote with qrData', async () => {
      const createQuoteDto: CreateQuoteDto = {
        sellAssetId: 'eip155:1/slip44:60',
        buyAssetId: 'bip122:000000000019d6689c085ae165831e93/slip44:0',
        sellAmountCryptoBaseUnit: '1000000000000000000',
        receiveAddress: 'bc1qtest123',
        swapperName: SwapperName.Chainflip,
        expectedBuyAmountCryptoBaseUnit: '3000000',
        sellAsset: { symbol: 'ETH', name: 'Ethereum' },
        buyAsset: { symbol: 'BTC', name: 'Bitcoin' },
      };

      quotesService.createQuote.mockResolvedValue(mockQuoteResponse);

      const result = await controller.createQuote(createQuoteDto);

      expect(result.qrData).toBeDefined();
      expect(result.qrData).toContain('ethereum:');
    });

    it('should return a quote with 30-minute expiration', async () => {
      const createQuoteDto: CreateQuoteDto = {
        sellAssetId: 'eip155:1/slip44:60',
        buyAssetId: 'bip122:000000000019d6689c085ae165831e93/slip44:0',
        sellAmountCryptoBaseUnit: '1000000000000000000',
        receiveAddress: 'bc1qtest123',
        swapperName: SwapperName.Chainflip,
        expectedBuyAmountCryptoBaseUnit: '3000000',
        sellAsset: { symbol: 'ETH', name: 'Ethereum' },
        buyAsset: { symbol: 'BTC', name: 'Bitcoin' },
      };

      quotesService.createQuote.mockResolvedValue(mockQuoteResponse);

      const result = await controller.createQuote(createQuoteDto);

      expect(result.expiresAt).toBeDefined();
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('getQuote', () => {
    it('should get a quote by id', async () => {
      const quoteId = 'quote_abc123';
      quotesService.getQuote.mockResolvedValue(mockQuoteResponse);

      const result = await controller.getQuote(quoteId);

      expect(result).toEqual(mockQuoteResponse);
      expect(quotesService.getQuote).toHaveBeenCalledWith(quoteId);
    });
  });
});
