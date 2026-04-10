import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { CustomerService } from './customer.service';
import { Customer } from './entities/customer.entity';

describe('CustomerService', () => {
  let service: CustomerService;
  let repository: jest.Mocked<Partial<Repository<Customer>>>;

  const mockCustomer: Partial<Customer> = {
    id: '123e4567-e89b-12d3-a456-426614174001',
    document: '12345678901',
    fullName: 'John Doe',
    birthDate: new Date('1990-01-15'),
    email: 'john@example.com',
    phone: '11999999999',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn().mockReturnValue(mockCustomer),
      save: jest.fn().mockResolvedValue(mockCustomer),
      findOne: jest.fn().mockResolvedValue(mockCustomer),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: getRepositoryToken(Customer), useValue: repository },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
  });

  describe('create', () => {
    it('should create a new customer', async () => {
      repository.findOne!.mockResolvedValueOnce(null);

      const result = await service.create({
        document: '12345678901',
        fullName: 'John Doe',
        birthDate: '1990-01-15',
        email: 'john@example.com',
        phone: '11999999999',
      });

      expect(result).toEqual(mockCustomer);
    });

    it('should throw ConflictException if document/email already exists', async () => {
      repository.findOne!.mockResolvedValueOnce(mockCustomer as Customer);

      await expect(
        service.create({
          document: '12345678901',
          fullName: 'John Doe',
          birthDate: '1990-01-15',
          email: 'john@example.com',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('findOne', () => {
    it('should return a customer', async () => {
      const result = await service.findOne(mockCustomer.id!);
      expect(result).toEqual(mockCustomer);
    });

    it('should throw NotFoundException if not found', async () => {
      repository.findOne!.mockResolvedValue(null);
      await expect(service.findOne('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findActiveOrFail', () => {
    it('should return active customer', async () => {
      const result = await service.findActiveOrFail(mockCustomer.id!);
      expect(result.active).toBe(true);
    });

    it('should throw BadRequestException if customer is inactive', async () => {
      repository.findOne!.mockResolvedValue({
        ...mockCustomer,
        active: false,
      } as Customer);

      await expect(
        service.findActiveOrFail(mockCustomer.id!),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('inactivate', () => {
    it('should set customer active to false', async () => {
      const inactiveCustomer = { ...mockCustomer, active: false };
      repository.save!.mockResolvedValue(inactiveCustomer as Customer);

      const result = await service.inactivate(mockCustomer.id!);
      expect(result.active).toBe(false);
    });
  });

  describe('activate', () => {
    it('should set customer active to true', async () => {
      repository.findOne!.mockResolvedValue({
        ...mockCustomer,
        active: false,
      } as Customer);
      repository.save!.mockResolvedValue({
        ...mockCustomer,
        active: true,
      } as Customer);

      const result = await service.activate(mockCustomer.id!);
      expect(result.active).toBe(true);
    });
  });
});
